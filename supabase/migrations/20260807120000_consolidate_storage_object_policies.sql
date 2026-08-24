-- Consolidate storage.objects policies to one policy per bucket/action.
-- This migration changes authorization metadata only; it does not delete objects.
-- Rollback: restore the storage.objects policy dump captured before applying this
-- migration, then restore bucket visibility from that same dump.

-- Remove every policy created by the previous Storage migrations for these buckets.
DROP POLICY IF EXISTS "Managers can upload job photos" ON storage.objects;
DROP POLICY IF EXISTS "Everyone can view job photos" ON storage.objects;

DROP POLICY IF EXISTS "Users can upload photos to their reports" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own report photos" ON storage.objects;
DROP POLICY IF EXISTS "Managers can view all report photos" ON storage.objects;

DROP POLICY IF EXISTS "Users can upload job completion photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can view job completion photos" ON storage.objects;
DROP POLICY IF EXISTS "Managers can view all job completion photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload job completion photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read job completion photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own job completion photos" ON storage.objects;
DROP POLICY IF EXISTS "Managers can view all completion photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own completion photos" ON storage.objects;

DROP POLICY IF EXISTS "Users can upload own completion voice notes" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own completion voice notes" ON storage.objects;
DROP POLICY IF EXISTS "Managers can view all completion voice notes" ON storage.objects;
DROP POLICY IF EXISTS "Managers can upload review voice notes" ON storage.objects;

DROP POLICY IF EXISTS "Authenticated users can upload invoices" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own invoices" ON storage.objects;
DROP POLICY IF EXISTS "Managers can view all invoices" ON storage.objects;
DROP POLICY IF EXISTS "Managers can access all invoice images" ON storage.objects;
DROP POLICY IF EXISTS "Users can access their own uploaded invoices" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own invoices" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own invoices" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own invoices" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own invoices" ON storage.objects;
DROP POLICY IF EXISTS "Managers can delete all invoices" ON storage.objects;

DROP POLICY IF EXISTS "Authenticated users can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for documents" ON storage.objects;
DROP POLICY IF EXISTS "Managers can delete documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete documents" ON storage.objects;

DROP POLICY IF EXISTS "Everyone can view material photos" ON storage.objects;
DROP POLICY IF EXISTS "Managers can upload material photos" ON storage.objects;
DROP POLICY IF EXISTS "Managers can update material photos" ON storage.objects;
DROP POLICY IF EXISTS "Managers can delete material photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view storage material photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload storage material photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update storage material photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete storage material photos" ON storage.objects;

DROP POLICY IF EXISTS "Authenticated users can upload rubbish photos" ON storage.objects;
DROP POLICY IF EXISTS "Public can view rubbish photos" ON storage.objects;
DROP POLICY IF EXISTS "Managers can delete rubbish photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view rubbish photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update rubbish photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete rubbish photos" ON storage.objects;

DROP POLICY IF EXISTS "Anyone can view risk assessment PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Managers can upload risk assessment PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Managers can delete risk assessment PDFs" ON storage.objects;

-- Make bucket visibility agree with the policy contract.
UPDATE storage.buckets SET public = false
WHERE id IN ('job-photos', 'job-completion-photos', 'daily-report-photos', 'invoices', 'job-voice-notes', 'job-review-voice-notes');

UPDATE storage.buckets SET public = false
WHERE id IN ('documents', 'storage-material-photos', 'rubbish-photos');

UPDATE storage.buckets SET public = true
WHERE id = 'risk-assessments';

-- job-photos: managers upload; authenticated users read reference photos.
CREATE POLICY "storage_job_photos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'job-photos' AND has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "storage_job_photos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'job-photos');

-- daily-report-photos: builders own their paths; managers can review all reports.
CREATE POLICY "storage_daily_report_photos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'daily-report-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "storage_daily_report_photos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'daily-report-photos'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR has_role(auth.uid(), 'manager'::app_role)
    )
  );

-- job-completion-photos: the first path segment is job_completions.id.
CREATE POLICY "storage_job_completion_photos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'job-completion-photos'
    AND EXISTS (
      SELECT 1
      FROM public.job_completions jc
      WHERE jc.id::text = (storage.foldername(name))[1]
        AND jc.completed_by = auth.uid()
    )
  );

CREATE POLICY "storage_job_completion_photos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'job-completion-photos'
    AND (
      has_role(auth.uid(), 'manager'::app_role)
      OR EXISTS (
        SELECT 1
        FROM public.job_completions jc
        WHERE jc.id::text = (storage.foldername(name))[1]
          AND jc.completed_by = auth.uid()
      )
    )
  );

-- Voice notes are private and use the owner's UUID as their first path segment.
CREATE POLICY "storage_job_voice_notes_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'job-voice-notes'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "storage_job_voice_notes_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'job-voice-notes'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR has_role(auth.uid(), 'manager'::app_role)
    )
  );

CREATE POLICY "storage_job_review_voice_notes_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'job-review-voice-notes'
    AND has_role(auth.uid(), 'manager'::app_role)
  );

CREATE POLICY "storage_job_review_voice_notes_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'job-review-voice-notes'
    AND has_role(auth.uid(), 'manager'::app_role)
  );

-- invoices: owners manage their files; managers can review/delete any invoice.
CREATE POLICY "storage_invoices_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'invoices' AND owner = auth.uid());

CREATE POLICY "storage_invoices_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'invoices'
    AND (owner = auth.uid() OR has_role(auth.uid(), 'manager'::app_role))
  );

CREATE POLICY "storage_invoices_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'invoices' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'invoices' AND owner = auth.uid());

CREATE POLICY "storage_invoices_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'invoices'
    AND (owner = auth.uid() OR has_role(auth.uid(), 'manager'::app_role))
  );

-- documents: managers write; authenticated users read documents used by the app.
CREATE POLICY "storage_documents_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "storage_documents_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'documents');

CREATE POLICY "storage_documents_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'documents' AND has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (bucket_id = 'documents' AND has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "storage_documents_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "storage_material_photos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'storage-material-photos' AND has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "storage_material_photos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'storage-material-photos' AND has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "storage_material_photos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'storage-material-photos' AND has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (bucket_id = 'storage-material-photos' AND has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "storage_material_photos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'storage-material-photos' AND has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "storage_rubbish_photos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rubbish-photos');

CREATE POLICY "storage_rubbish_photos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'rubbish-photos'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR has_role(auth.uid(), 'manager'::app_role)
    )
  );

CREATE POLICY "storage_rubbish_photos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'rubbish-photos' AND has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "storage_risk_assessments_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'risk-assessments' AND has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "storage_risk_assessments_select" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'risk-assessments');

CREATE POLICY "storage_risk_assessments_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'risk-assessments' AND has_role(auth.uid(), 'manager'::app_role));
