terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

# Región fija: CloudFront solo acepta certificados ACM de us-east-1.
provider "aws" {
  region = "us-east-1"
}
