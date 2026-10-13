# Estado compartido: local y GitHub Actions usan el mismo state.
terraform {
  backend "s3" {
    bucket = "vigencia-terraform-estado-443507914831"
    key    = "landing/terraform.tfstate"
    region = "us-east-1"
  }
}
