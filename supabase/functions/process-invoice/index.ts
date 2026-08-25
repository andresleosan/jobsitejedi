import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.77.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl, supplierId } = await req.json();
    const authHeader = req.headers.get("Authorization");
    
    // Verify user authentication
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized - missing auth token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create client with user JWT for validation
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      console.error("Auth error:", userError);
      return new Response(
        JSON.stringify({ error: "Unauthorized - invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check user role (both managers and builders can process invoices)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (roleError || !roleData || !["manager", "builder"].includes(roleData.role)) {
      console.error("Role check failed:", roleError);
      return new Response(
        JSON.stringify({ error: "Forbidden - insufficient permissions" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Invoice processing requested by user ${user.id} with role ${roleData.role}`);

    // Get training data for supplier if provided
    let trainingData = null;
    if (supplierId) {
      const { data } = await supabase
        .from("invoice_extraction_training")
        .select("field_name, field_path")
        .eq("supplier_id", supplierId);
      trainingData = data;
    }

    // Call Lovable AI with vision capabilities
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    let systemPrompt = `You are an invoice data extraction assistant. Extract the following fields from the invoice image:
    - invoice_number
    - date (format: YYYY-MM-DD)
    - total_amount (numeric value only)
    - supplier_name
    - line_items (array of {description, quantity, unit_price, total})
    
    Return the data as a JSON object with these exact field names.`;

    if (trainingData && trainingData.length > 0) {
      systemPrompt += `\n\nFor this supplier, use the following extraction rules:\n`;
      trainingData.forEach((rule: { field_name: string; field_path: string }) => {
        systemPrompt += `- ${rule.field_name}: ${rule.field_path}\n`;
      });
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract all invoice data from this image." },
              { type: "image_url", image_url: { url: imageUrl } }
            ]
          }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: "AI processing failed", details: errorText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResponse.json();
    const extractedText = aiData.choices[0].message.content;
    
    // Parse the JSON from the response
    let extractedData;
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = extractedText.match(/```json\n([\s\S]*?)\n```/) || 
                       extractedText.match(/```\n([\s\S]*?)\n```/) ||
                       [null, extractedText];
      extractedData = JSON.parse(jsonMatch[1] || extractedText);
    } catch (e) {
      console.error("JSON parsing error:", e);
      extractedData = { raw_text: extractedText };
    }

    return new Response(
      JSON.stringify({ extractedData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in process-invoice:", error);
    const message = error instanceof Error ? error.message : "Unexpected invoice processing error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
