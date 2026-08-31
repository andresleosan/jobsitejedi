import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import BuilderDashboard from "@/components/dashboard/BuilderDashboard";
import { roleHomePath } from "@/lib/firebase/types";

const Builders = () => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      navigate("/auth");
      return;
    }
    if (user.role && user.role !== "builder") navigate(roleHomePath(user.role), { replace: true });
  }, [isLoading, navigate, user]);

  if (isLoading || !user || user.role !== "builder") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <BuilderDashboard userId={user.id} />;
};

export default Builders;
