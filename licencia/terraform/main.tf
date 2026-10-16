terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.6"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "wompi_env" {
  type    = string
  default = "sandbox"
}

variable "wompi_public_key" {
  type      = string
  sensitive = true
}

variable "wompi_private_key" {
  type      = string
  sensitive = true
}

variable "wompi_integrity_secret" {
  type      = string
  sensitive = true
}

variable "wompi_events_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "comentarios_clave" {
  description = "Clave del equipo para leer y moderar comentarios en la página de administración."
  type        = string
  sensitive   = true
}

resource "aws_dynamodb_table" "comentarios" {
  name         = "vigencia-comentarios"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
}

resource "aws_dynamodb_table" "licencias" {
  name         = "vigencia-licencias"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "instalacion"

  attribute {
    name = "instalacion"
    type = "S"
  }

  attribute {
    name = "pendiente"
    type = "S"
  }

  attribute {
    name = "referenciaPagada"
    type = "S"
  }

  global_secondary_index {
    name            = "pendiente-index"
    hash_key        = "pendiente"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "pagada-index"
    hash_key        = "referenciaPagada"
    projection_type = "ALL"
  }
}

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/.."
  output_path = "${path.module}/licencia.zip"
  excludes = [
    "terraform",
    "claves",
    "datos",
    ".gitignore",
  ]
}

resource "aws_iam_role" "lambda" {
  name = "vigencia-licencia"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "tabla" {
  name = "vigencia-licencias"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"]
        Resource = [
          aws_dynamodb_table.licencias.arn,
          "${aws_dynamodb_table.licencias.arn}/index/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:Scan", "dynamodb:UpdateItem"]
        Resource = [aws_dynamodb_table.comentarios.arn]
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/vigencia-licencia"
  retention_in_days = 30
}

resource "aws_lambda_function" "licencia" {
  function_name    = "vigencia-licencia"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  handler          = "lambda.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 15
  memory_size      = 256

  lifecycle {
    precondition {
      condition     = try(base64encode(file("${path.module}/../claves/licencia-privada.pem")), "") != ""
      error_message = "Falta licencia/claves/licencia-privada.pem: sin la llave de firma no se despliega."
    }
  }

  environment {
    variables = {
      TABLA_LICENCIAS        = aws_dynamodb_table.licencias.name
      TABLA_COMENTARIOS      = aws_dynamodb_table.comentarios.name
      COMENTARIOS_CLAVE      = var.comentarios_clave
      URL_PUBLICA            = aws_apigatewayv2_api.licencia.api_endpoint
      LICENCIA_PRIVADA_B64   = try(base64encode(file("${path.module}/../claves/licencia-privada.pem")), "")
      WOMPI_ENV              = var.wompi_env
      WOMPI_PUBLIC_KEY       = var.wompi_public_key
      WOMPI_PRIVATE_KEY      = var.wompi_private_key
      WOMPI_INTEGRITY_SECRET = var.wompi_integrity_secret
      WOMPI_EVENTS_SECRET    = var.wompi_events_secret
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy_attachment.logs,
    aws_iam_role_policy.tabla,
  ]
}

resource "aws_apigatewayv2_api" "licencia" {
  name          = "vigencia-licencia"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["https://vigencia.askleia.co"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type", "x-clave"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.licencia.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.licencia.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.licencia.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.licencia.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "api" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.licencia.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.licencia.execution_arn}/*/*"
}

output "url" {
  value = aws_apigatewayv2_api.licencia.api_endpoint
}
