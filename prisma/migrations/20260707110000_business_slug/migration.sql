ALTER TABLE "Business" ADD COLUMN "slug" TEXT;

UPDATE "Business"
SET "slug" = LOWER(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(NULLIF(TRIM("name"), ''), "id"), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')) || '-' || SUBSTRING("id" FROM 1 FOR 8)
WHERE "slug" IS NULL;

ALTER TABLE "Business" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");
