FROM eclipse-temurin:21-jdk-alpine AS build

ARG SERVICE_NAME
WORKDIR /workspace

COPY . .

# -am construye common-errors antes del servicio elegido por -pl.
RUN chmod +x auth-service/mvnw \
    && ./auth-service/mvnw --batch-mode --quiet -pl "${SERVICE_NAME}" -am -DskipTests package \
    && cp "${SERVICE_NAME}"/target/*.jar application.jar

FROM eclipse-temurin:21-jre-alpine AS runtime

RUN addgroup -S spring && adduser -S spring -G spring

WORKDIR /app

COPY --from=build \
    --chown=spring:spring \
    /workspace/application.jar \
    ./application.jar

USER spring:spring

ENTRYPOINT ["java", "-jar", "/app/application.jar"]

# Solo Auth necesita preparar la llave privada antes de bajar privilegios.
FROM runtime AS auth-runtime

USER root
RUN apk add --no-cache su-exec
COPY --chmod=0555 docker/auth-entrypoint.sh /usr/local/bin/auth-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/auth-entrypoint.sh"]
CMD ["java", "-jar", "/app/application.jar"]

# Mantener el arranque no privilegiado por defecto para los demas servicios.
FROM runtime AS service-runtime
