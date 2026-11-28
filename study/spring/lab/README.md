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
| [step03-transactional-outbox](step03-transactional-outbox) | 커밋 후 이벤트 유실을 outbox + SKIP LOCKED 릴레이로 막기 | [Spring 04](../04-transactional-outbox.md) | [글 저장과 메시지 보내기](../figures/step03-transactional-outbox) |
| [step04-rabbitmq-inbox](step04-rabbitmq-inbox) | RabbitMQ 로 받은 이벤트를 inbox(유니크 키 + 리스 + 스케줄러)로 한 번만 처리 | [Spring 05](../05-rabbitmq-inbox.md) | [같은 메시지가 두 번 와도](../figures/step04-rabbitmq-inbox) |
| step05 (코드 없음) | 재시도 설계: 리스 부등식 · 호출 타임아웃 · 지수 백오프 · `next_attempt_at` · 펜싱 토큰 · 만료. 구현은 Resilience4j 단계에서 | [Spring 06](../06-retry-lease-fencing.md) | [느린 FCM, 장애, 늦게 돌아온 워커](../figures/step05-retry-lease-fencing) |
| [step06-valkey-cache](step06-valkey-cache) | 동네 최신 글 목록을 Valkey 에: ID 목록 + 글마다 요약, 이벤트로 지우기, single-flight(`SET NX PX`), 지연 이중 삭제, TTL 지터 | [Spring 07](../07-valkey-cache.md) | [동네 목록 캐시](../figures/step06-valkey-cache) |

## 두 단계 비교하기

```bash
diff -r step01-post-api/src step02-connection-pool/src
diff -r step02-connection-pool/src step03-transactional-outbox/src
diff -r step03-transactional-outbox/src step04-rabbitmq-inbox/src
diff -r step04-rabbitmq-inbox/src step06-valkey-cache/src
```

IntelliJ에서는 두 폴더를 함께 선택하고 ⌘D(Compare Directories).

## 실행

이 폴더(`study/spring/lab`)에서 실행합니다. JDK 21과 Docker가 필요합니다.

```bash
docker compose up -d                       # 로컬 Postgres (127.0.0.1:5433), RabbitMQ (127.0.0.1:5673, 관리 화면 :15673), Valkey (127.0.0.1:6380). 단계마다 스키마가 따로(step01, step02 …)
./gradlew :step01-post-api:bootRun         # http://localhost:8080 (한 번에 한 단계만)
./gradlew test                             # 모든 단계 테스트. Testcontainers로 별도 Postgres(step04 부터 RabbitMQ, step06 부터 Valkey 도)를 띄웁니다
./gradlew :step02-connection-pool:test --tests '*PoolExhaustion*' -i | grep 실험
./gradlew :step03-transactional-outbox:test --tests '*EventDelivery*' -i | grep 실험
./gradlew :step04-rabbitmq-inbox:test --tests '*NotificationInbox*' -i | grep 실험
./gradlew :step06-valkey-cache:test --tests '*FeedCache*' -i | grep 실험
```

```bash
curl -XPOST localhost:8080/posts -H 'content-type: application/json' \
  -d '{"authorId":1,"regionId":100,"content":"붕어빵 파는 곳 있나요?"}'
curl 'localhost:8080/posts?regionId=100'
```

step03 에서 브로커 장애를 손으로 재현하기:

```bash
curl -XPOST 'localhost:8080/experiments/events/broker?down=true'   # 브로커 끄기
curl -XPOST localhost:8080/experiments/events/outbox -H 'content-type: application/json' \
  -d '{"authorId":1,"regionId":100,"content":"벼룩시장 열려요"}'          # 201, outbox 행만 남음
curl -XPOST 'localhost:8080/experiments/events/broker?down=false'  # 브로커 켜기 → 1초 안에 릴레이가 보냄
curl localhost:8080/experiments/events/broker                      # {"down":false,"received":1}
```

step04 에서 글 하나가 이웃 1,000명 알림이 되는 것 보기:

```bash
docker exec spring-lab-postgres psql -U community -d community \
  -c "insert into step04.region_member select 777, g from generate_series(1,1000) g on conflict do nothing"
./gradlew :step04-rabbitmq-inbox:bootRun
curl -XPOST localhost:8080/posts -H 'content-type: application/json' \
  -d '{"authorId":1,"regionId":777,"content":"붕어빵 트럭 왔어요"}'
docker exec spring-lab-postgres psql -U community -d community \
  -c "select state, count(*) from step04.notification_delivery group by state"   # completed 1000
```

step06 에서 동네 목록이 캐시에서 나오는 것 보기:

```bash
./gradlew :step06-valkey-cache:bootRun
curl -XPOST localhost:8080/posts -H 'content-type: application/json' \
  -d '{"authorId":1,"regionId":42,"content":"나눔합니다","title":"상추 나눔햇어요"}'
curl localhost:8080/regions/42/feed                                       # 처음엔 DB 에서 만들어 Valkey 에 넣음
docker exec spring-lab-valkey valkey-cli zrevrange region:42:latest 0 -1  # 글 ID (와 표시용 0)
curl -XPATCH localhost:8080/posts/1 -H 'content-type: application/json' -d '{"title":"상추 나눔했어요"}'
curl localhost:8080/regions/42/feed                                       # 1~2초 뒤 새 제목 (릴레이 1초 주기 → 이벤트가 post:1 을 지움)
```

## 그림 다시 만들기

```bash
node ../figures/step01-request-flow/build.mjs   # → index.html, index-light.html
```

공통 페이지 틀과 색은 [`../figures/page.mjs`](../figures/page.mjs)에 있습니다.

스택: JDK 21 (Temurin), Kotlin 2.4, Spring Boot 4.2, PostgreSQL 17, RabbitMQ 4.1, Valkey 8.1, Flyway, Testcontainers 2
