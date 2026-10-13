# Vigencia · landing (vigencia.askleia.co)
# S3 privado + CloudFront con OAC + SSL (ACM en us-east-1).
# El dominio vive en Namecheap: los registros DNS se crean a mano
# con los valores de `terraform output registros_dns`.

# ---------- S3: archivos del sitio, sin acceso público directo ----------
resource "aws_s3_bucket" "sitio" {
  bucket = var.bucket

  tags = {
    Proyecto = "vigencia-landing"
  }
}

resource "aws_s3_bucket_public_access_block" "sitio" {
  bucket                  = aws_s3_bucket.sitio.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "sitio" {
  bucket = aws_s3_bucket.sitio.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "sitio" {
  bucket = aws_s3_bucket.sitio.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "sitio" {
  name                              = "vigencia-landing"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_s3_bucket_policy" "sitio" {
  bucket = aws_s3_bucket.sitio.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "SoloCloudFront"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.sitio.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.sitio.arn
        }
      }
    }]
  })
}

# ---------- SSL: certificado con validación por DNS ----------
resource "aws_acm_certificate" "sitio" {
  domain_name       = var.dominio
  validation_method = "DNS"

  tags = {
    Proyecto = "vigencia-landing"
  }
}

# Espera a que el CNAME de validación exista en Namecheap.
# Si el tiempo se agota, crea el registro y corre `terraform apply` de nuevo.
resource "aws_acm_certificate_validation" "sitio" {
  certificate_arn = aws_acm_certificate.sitio.arn

  timeouts {
    create = "60m"
  }
}

# ---------- CloudFront ----------
data "aws_cloudfront_cache_policy" "desactivada" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimizada" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "sitio" {
  enabled             = true
  aliases             = [var.dominio]
  default_root_object = "index.html"
  price_class         = var.price_class
  http_version        = "http2and3"

  origin {
    domain_name              = aws_s3_bucket.sitio.bucket_regional_domain_name
    origin_id                = "s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.sitio.id
  }

  # HTML y lo demás: siempre fresco (el despliegue invalida).
  default_cache_behavior {
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.desactivada.id
  }

  # Instaladores (~100 MB, nombre fijo por versión): caché larga.
  ordered_cache_behavior {
    path_pattern           = "/Vigencia-*"
    target_origin_id       = "s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimizada.id
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.sitio.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = {
    Proyecto = "vigencia-landing"
  }
}
