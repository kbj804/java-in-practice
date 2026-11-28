plugins {
    kotlin("jvm")
    // all-open: Spring 이 프록시(@Transactional 등)를 만들 수 있게 클래스를 open 으로 만든다
    kotlin("plugin.spring")
    // no-arg: JPA 엔티티에 Hibernate 가 쓰는 기본 생성자를 만들어 준다
    kotlin("plugin.jpa")
    id("org.springframework.boot")
    id("io.spring.dependency-management")
}

group = "kr.aloui"
version = "0.0.1-SNAPSHOT"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    // RabbitMQ: RabbitTemplate(보내기)과 @RabbitListener(받기)
    implementation("org.springframework.boot:spring-boot-starter-rabbitmq")
    // Valkey: Redis 와 같은 프로토콜이라 Spring Data Redis(Lettuce 클라이언트)로 붙는다
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
    implementation("org.flywaydb:flyway-database-postgresql")
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("tools.jackson.module:jackson-module-kotlin")
    runtimeOnly("org.postgresql:postgresql")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.testcontainers:testcontainers-junit-jupiter")
    testImplementation("org.testcontainers:testcontainers-postgresql")
    testImplementation("org.testcontainers:testcontainers-rabbitmq")
    // 리스너는 다른 스레드에서 돈다. 결과가 나올 때까지 기다리는 데 쓴다.
    testImplementation("org.awaitility:awaitility-kotlin")
    testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin {
    compilerOptions {
        freeCompilerArgs.addAll("-Xjsr305=strict")
    }
}

// JPA 엔티티는 Hibernate 가 지연 로딩 프록시를 만들 수 있게 open 이어야 한다
allOpen {
    annotation("jakarta.persistence.Entity")
    annotation("jakarta.persistence.MappedSuperclass")
    annotation("jakarta.persistence.Embeddable")
}

tasks.withType<Test> {
    useJUnitPlatform()
}
