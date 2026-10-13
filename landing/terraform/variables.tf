variable "dominio" {
  description = "Dominio de la landing. Vive en Namecheap; sus registros se crean a mano (ver outputs)."
  type        = string
  default     = "vigencia.askleia.co"
}

variable "bucket" {
  description = "Nombre del bucket S3 que guarda la landing."
  type        = string
  default     = "vigencia-askleia-co-sitio"
}

variable "price_class" {
  description = "Cobertura de edge locations. All incluye Sudamérica (recomendado para Colombia)."
  type        = string
  default     = "PriceClass_All"
}
