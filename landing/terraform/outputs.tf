output "dominio" {
  value = var.dominio
}

output "bucket" {
  value = aws_s3_bucket.sitio.id
}

output "distribution_id" {
  value = aws_cloudfront_distribution.sitio.id
}

output "distribution_domain" {
  value = aws_cloudfront_distribution.sitio.domain_name
}

# Registro que demuestra ante Amazon que el dominio es tuyo.
output "validacion_acm" {
  value = {
    for o in tolist(aws_acm_certificate.sitio.domain_validation_options) :
    o.domain_name => {
      tipo  = o.resource_record_type
      host  = o.resource_record_name
      valor = o.resource_record_value
    }
  }
}

# Tabla lista para copiar a Namecheap (Advanced DNS).
output "registros_dns" {
  value = {
    comentario = "Crear en Namecheap > Domain List > askleia.co > Manage > Advanced DNS"
    registros = [
      {
        para  = "SSL: validar el certificado en Amazon"
        host  = tolist(aws_acm_certificate.sitio.domain_validation_options)[0].resource_record_name
        tipo  = "CNAME"
        valor = tolist(aws_acm_certificate.sitio.domain_validation_options)[0].resource_record_value
        ttl   = "Automatic"
      },
      {
        para  = "Sitio: apuntar el subdominio a CloudFront"
        host  = var.dominio
        tipo  = "CNAME"
        valor = aws_cloudfront_distribution.sitio.domain_name
        ttl   = "Automatic"
      },
    ]
  }
}
