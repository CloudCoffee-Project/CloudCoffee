FROM eclipse-temurin:21-jdk-alpine AS build

ARG SERVICE_NAME
WORKDIR /workspace

COPY ${SERVICE_NAME}/.mvn ./.mvn
COPY ${SERVICE_NAME}/mvnw ./mvnw
COPY ${SERVICE_NAME}/pom.xml ./pom.xml

RUN chmod +x ./mvnw
RUN ./mvnw --batch-mode --quiet -DskipTests dependency:go-offline

COPY ${SERVICE_NAME}/src ./src

RUN ./mvnw --batch-mode --quiet -DskipTests package
RUN cp target/*.jar application.jar

FROM eclipse-temurin:21-jre-alpine

RUN addgroup -S spring && adduser -S spring -G spring

WORKDIR /app

COPY --from=build \
    --chown=spring:spring \
    /workspace/application.jar \
    ./application.jar

USER spring:spring

ENTRYPOINT ["java", "-jar", "/app/application.jar"]