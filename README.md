# java-in-practice

Python(FastAPI)으로 백엔드를 해 온 개발자가 Java를 공부하면서 남기는 기록입니다.

- **problems/**: 현업에서 실제로 부딪힌 문제를 Java로 다시 풀어 봅니다. Python에서는 어떻게 풀었는지, Java에서는 무엇이 달라지는지를 함께 적습니다.
- **study/**: JVM, Spring 같은 기본기를 공부하며 정리한 노트입니다.

## 목차

### study

| 주제 | 노트 |
|---|---|
| JVM | [01. JVM은 어떻게 동작하나 (식당 주방 비유)](study/jvm/01-how-jvm-works.md) |
| JVM | [02. Heap을 세대로 나누는 이유와 Minor GC·Full GC](study/jvm/02-generational-gc.md) |
| JVM | [03. G1 vs ZGC: 왜 GC가 두 개고, 각각 어떻게 동작하나](study/jvm/03-g1-vs-zgc.md) |
| JVM | [04. 가상 스레드 vs 플랫폼 스레드 (JDK 21)](study/jvm/04-virtual-threads.md) |
| JVM | [05. JVM 메이저 버전을 올린 직후 서버가 몇 시간마다 죽는다면](study/jvm/05-jvm-upgrade-periodic-crash.md) |
| JVM | [06. Kotlin 코루틴 vs 가상 스레드](study/jvm/06-kotlin-coroutines-vs-virtual-threads.md) |
| Spring | [01. 게시글 API로 본 Spring Boot 기본기 (FastAPI와 비교)](study/spring/01-spring-basics.md) |
| Spring | [02. 트랜잭션 안의 외부 호출과 커넥션 풀 고갈](study/spring/02-connection-pool.md) |
| Spring | [03. 동시 처리 상한이 없을 때: 타임아웃, 벌크헤드, 서킷 브레이커](study/spring/03-concurrency-limits.md) |
| Spring | [04. 커밋 후 이벤트 유실과 Transactional Outbox](study/spring/04-transactional-outbox.md) |
| Spring 실습 | [단계별 Kotlin + Spring Boot 코드와 그림](study/spring/lab/README.md) |

### problems

작성 방식은 [problems/README.md](problems/README.md)에 있습니다.

| 문제 | 노트 |
|---|---|
| 동시성 | [01. 결제 승인을 두 곳이 동시에 돌릴 때: 조건부 UPDATE 대신 "시간으로 비켜 가기"](problems/01-approval-race-without-lock/README.md) |
