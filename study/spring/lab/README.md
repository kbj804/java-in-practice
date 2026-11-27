# Spring 실습 (Kotlin + Spring Boot)

[Spring 노트](..)의 실험을 직접 돌려 보는 코드입니다.

## 규칙

- **단계마다 폴더 하나.** 각 단계는 따로 실행되는 Spring Boot 앱(Gradle 모듈)입니다.
- **앞 단계는 고치지 않습니다.** 다음 단계는 앞 단계 폴더를 복사해서 시작하고, 바뀐 부분만 고칩니다. 그래서 두 단계를 나란히 비교할 수 있습니다.
- **단계마다 그림 하나.** [`../figures/stepNN-*`](../figures)에 위에서 본 2D 그림(구조와 흐름)을 둡니다.

## 단계

| 단계 | 내용 | 노트 | 그림 |
|---|---|---|---|
| [step01-post-api](step01-post-api) | 게시글 작성·조회 API | [Spring 01](../01-spring-basics.md) | [요청 한 건의 길](../figures/step01-request-flow) |
| [step02-connection-pool](step02-connection-pool) | 트랜잭션 안의 외부 호출로 커넥션 풀 고갈 | [Spring 02](../02-connection-pool.md) | [커넥션 풀 고갈](../figures/step02-connection-pool) |

## 두 단계 비교하기

```bash
diff -r step01-post-api/src step02-connection-pool/src
```

IntelliJ에서는 두 폴더를 함께 선택하고 ⌘D(Compare Directories).

## 실행

이 폴더(`study/spring/lab`)에서 실행합니다. JDK 21과 Docker가 필요합니다.

```bash
docker compose up -d                       # 로컬 Postgres (127.0.0.1:5433). 단계마다 스키마가 따로(step01, step02 …)
./gradlew :step01-post-api:bootRun         # http://localhost:8080 (한 번에 한 단계만)
./gradlew test                             # 모든 단계 테스트. Testcontainers로 별도 Postgres를 띄웁니다
./gradlew :step02-connection-pool:test --tests '*PoolExhaustion*' -i | grep 실험
```

```bash
curl -XPOST localhost:8080/posts -H 'content-type: application/json' \
  -d '{"authorId":1,"regionId":100,"content":"붕어빵 파는 곳 있나요?"}'
curl 'localhost:8080/posts?regionId=100'
```

## 그림 다시 만들기

```bash
node ../figures/step01-request-flow/build.mjs   # → index.html, index-light.html
```

공통 페이지 틀과 색은 [`../figures/page.mjs`](../figures/page.mjs)에 있습니다.

스택: JDK 21 (Temurin), Kotlin 2.4, Spring Boot 4.2, PostgreSQL 17, Flyway, Testcontainers 2
