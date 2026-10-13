# Landing de Vigencia → https://vigencia.askleia.co
#
# Infra: S3 privado + CloudFront (OAC) + SSL (ACM, us-east-1).
# El dominio vive en Namecheap: sus registros se crean a mano.
#
# Orden de despliegue (el certificado exige validar el dominio por DNS):
#
#   1. cd landing/terraform && terraform init && terraform apply
#      El apply se detiene esperando la validación del certificado.
#   2. En otra terminal: terraform output -json registros_dns
#      Copia los dos registros a Namecheap:
#      Domain List > askleia.co > Manage > Advanced DNS > Add New Record.
#   3. Vuelve al apply: al detectar el CNAME, Amazon emite el
#      certificado y termina de crear la distribución (~10 min).
#   4. Publica el sitio: ../../script/desplegar.sh
#      (compila Astro, sincroniza dist/ a S3 e invalida CloudFront).
#
# Descargas: los botones del landing apuntan a
# https://vigencia.askleia.co/Vigencia-* (objetos estables en este bucket).
# Los alimenta el pipeline (tag v* → release de GitHub → S3 con
# electron/script/publicar-descargas.sh); este despliegue solo sube el sitio.
