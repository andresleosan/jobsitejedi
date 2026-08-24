-- Run after the consolidation migration in staging.
-- Every query should return zero rows, except the visibility query which should
-- return the expected rows shown by the result itself.

-- 1) Required canonical policies. Missing rows indicate an incomplete migration.
WITH expected(policyname, bucket_id, action) AS (
  VALUES
    ('storage_job_photos_insert', 'job-photos', 'INSERT'),
    ('storage_job_photos_select', 'job-photos', 'SELECT'),
    ('storage_daily_report_photos_insert', 'daily-report-photos', 'INSERT'),
    ('storage_daily_report_photos_select', 'daily-report-photos', 'SELECT'),
    ('storage_job_completion_photos_insert', 'job-completion-photos', 'INSERT'),
    ('storage_job_completion_photos_select', 'job-completion-photos', 'SELECT'),
    ('storage_job_voice_notes_insert', 'job-voice-notes', 'INSERT'),
    ('storage_job_voice_notes_select', 'job-voice-notes', 'SELECT'),
    ('storage_job_review_voice_notes_insert', 'job-review-voice-notes', 'INSERT'),
    ('storage_job_review_voice_notes_select', 'job-review-voice-notes', 'SELECT'),
    ('storage_invoices_insert', 'invoices', 'INSERT'),
    ('storage_invoices_select', 'invoices', 'SELECT'),
    ('storage_invoices_update', 'invoices', 'UPDATE'),
    ('storage_invoices_delete', 'invoices', 'DELETE'),
    ('storage_documents_insert', 'documents', 'INSERT'),
    ('storage_documents_select', 'documents', 'SELECT'),
    ('storage_documents_update', 'documents', 'UPDATE'),
    ('storage_documents_delete', 'documents', 'DELETE'),
    ('storage_material_photos_insert', 'storage-material-photos', 'INSERT'),
    ('storage_material_photos_select', 'storage-material-photos', 'SELECT'),
    ('storage_material_photos_update', 'storage-material-photos', 'UPDATE'),
    ('storage_material_photos_delete', 'storage-material-photos', 'DELETE'),
    ('storage_rubbish_photos_insert', 'rubbish-photos', 'INSERT'),
    ('storage_rubbish_photos_select', 'rubbish-photos', 'SELECT'),
    ('storage_rubbish_photos_delete', 'rubbish-photos', 'DELETE'),
    ('storage_risk_assessments_insert', 'risk-assessments', 'INSERT'),
    ('storage_risk_assessments_select', 'risk-assessments', 'SELECT'),
    ('storage_risk_assessments_delete', 'risk-assessments', 'DELETE')
)
SELECT e.*
FROM expected e
LEFT JOIN pg_policies p
  ON p.schemaname = 'storage'
 AND p.tablename = 'objects'
 AND p.policyname = e.policyname
WHERE p.policyname IS NULL
ORDER BY e.bucket_id, e.action;

-- 2) Bucket visibility. This should return exactly the expected values.
SELECT id, public AS expected_public
FROM storage.buckets
WHERE id IN (
  'job-photos', 'job-completion-photos', 'daily-report-photos',
  'invoices', 'job-voice-notes', 'job-review-voice-notes',
  'documents', 'storage-material-photos', 'rubbish-photos', 'risk-assessments'
)
ORDER BY id;

-- 3) Legacy policies that must no longer exist after consolidation.
SELECT policyname
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname IN (
    'Users can upload job completion photos',
    'Users can view job completion photos',
    'Managers can view all job completion photos',
    'Authenticated can upload job completion photos',
    'Authenticated can read job completion photos',
    'Users can upload their own job completion photos',
    'Managers can view all completion photos',
    'Users can view own completion photos',
    'Everyone can view job photos',
    'Public read access for documents',
    'Everyone can view material photos',
    'Public can view rubbish photos'
  )
ORDER BY policyname;
