FROM eclipse-temurin:21-jdk-alpine AS build

ARG SERVICE_NAME
WORKDIR /workspace

COPY . .

# -am construye common-errors antes del servicio elegido por -pl.
RUN chmod +x auth-service/mvnw \
    && ./auth-service/mvnw --batch-mode --quiet -pl "${SERVICE_NAME}" -am -DskipTests package \
    && cp "${SERVICE_NAME}"/target/*.jar application.jar

FROM eclipse-temurin:21-jre-alpine

RUN addgroup -S spring && adduser -S spring -G spring

WORKDIR /app

COPY --from=build \
    --chown=spring:spring \
    /workspace/application.jar \
    ./application.jar

USER spring:spring

ENTRYPOINT ["java", "-jar", "/app/application.jar"]
