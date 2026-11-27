rootProject.name = "spring-lab"

// 단계마다 독립된 Spring Boot 앱. 다음 단계는 앞 단계를 복사해서 시작하고, 앞 단계는 고치지 않는다.
include(
    "step01-post-api",
    "step02-connection-pool",
    "step03-transactional-outbox",
)
