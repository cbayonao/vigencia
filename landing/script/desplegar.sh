#!/usr/bin/env bash
# Publica la landing: compila Astro, sube dist/ a S3 e invalida CloudFront.
set -euo pipefail

cd "$(dirname "$0")/.."

npm run build

BUCKET=$(terraform -chdir=terraform output -raw bucket)
DIST=$(terraform -chdir=terraform output -raw distribution_id)

aws s3 sync dist/ "s3://$BUCKET" --delete
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" \
  --query Invalidation.Id --output text
