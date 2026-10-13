#!/usr/bin/env bash
# Espeja los instaladores del release de GitHub a S3 con nombres estables,
# que son los que enlaza el landing (el repo es privado y sus releases no
# son descargables por el público).
# Uso: ./publicar-descargas.sh v3.1.0   (sin argumento: último release)
set -euo pipefail

TAG="${1:-$(gh release view --json tagName -q .tagName)}"
BUCKET="vigencia-askleia-co-sitio"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

gh release download "$TAG" --dir "$tmp" --pattern 'Vigencia*'
aws s3 cp "$tmp" "s3://$BUCKET/" --recursive --exclude '*' --include 'Vigencia*'

DIST=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Items[0]=='vigencia.askleia.co'].Id" \
  --output text)
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/Vigencia*" \
  --query Invalidation.Id --output text
