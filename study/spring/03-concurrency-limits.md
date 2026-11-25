# 03. 동시 처리 상한이 없을 때: 타임아웃, 벌크헤드, 서킷 브레이커

[JVM 05번 노트](../jvm/05-jvm-upgrade-periodic-crash.md)의 "동시 처리 상한이 사라져서 메모리가 터짐"에 대한 대응책을 정리한 노트입니다. [02. 커넥션 풀 고갈](02-connection-pool.md)과 [JVM 04. 가상 스레드](../jvm/04-virtual-threads.md)를 읽었다고 가정합니다.

## 문제 다시 보기

- 플랫폼 스레드 시절에는 Tomcat 스레드 200개가 **"동시에 처리하는 요청은 최대 200개"라는 상한을 덤으로** 줬습니다. 201번째 요청은 앞 요청이 끝날 때까지 기다렸습니다.
- 가상 스레드를 켜면 이 덤이 사라집니다(Spring Boot에서 `server.tomcat.threads.max`가 더는 적용되지 않습니다). 트래픽이 몰리면 요청 수천 개가 동시에 들어와 Heap에 객체를 만들고, DB와 외부 API로 몰려갑니다.
- 결과는 둘 중 하나입니다. 우리 서버가 `OutOfMemoryError`로 죽거나, 다음 단계(DB, 외부 API)가 무너지고 그 지연이 다시 우리 서버로 번집니다.

**주방 비유:** 예전에는 주방 의자가 200개뿐이라 손님이 아무리 와도 200명만 앉았습니다. 가상 스레드는 의자를 무한히 늘린 것입니다. 의자는 늘었지만 화구(DB 커넥션)와 납품업체(외부 API)는 그대로라, 손님만 잔뜩 앉아 아무도 음식을 못 받습니다. 그래서 **입구에서 인원을 세는 직원**을 따로 둬야 합니다.

## 대응은 한 가지가 아니라 층으로 쌓습니다

| 장치 | 막는 것 | 질문 |
|---|---|---|
| 타임아웃 | 한 요청이 자원을 **너무 오래** 붙잡는 것 | 얼마나 기다릴까 |
| 동시 처리 상한 (벌크헤드, 로드 셰딩) | 한꺼번에 **너무 많이** 들어오는 것 | 몇 개까지 받을까 |
| 레이트 리미터 | 시간당 **너무 자주** 부르는 것 | 초당 몇 번까지 부를까 |
| 서킷 브레이커 | **이미 고장 난** 곳을 계속 부르는 것 | 지금 불러도 될까 |
| 재시도 | 일시적인 실패 | 한 번 더 해 볼까 |

자주 하는 오해가 있습니다. **서킷 브레이커는 동시 처리 수를 제한하지 않습니다.** 서킷 브레이커는 실패나 느린 응답이 **쌓인 뒤에** 반응합니다. 그동안 들어온 요청 수천 개는 이미 다음 단계로 몰려간 뒤입니다. 상한은 벌크헤드가 걸고, 서킷 브레이커는 그 위에 얹습니다.

## 1. 타임아웃: 모든 기다림에 끝을 둡니다

다른 장치가 모두 타임아웃에 기대기 때문에 가장 먼저 합니다. 끝나지 않는 호출은 실패로도, 느린 호출로도 집계되지 않아서 서킷 브레이커가 반응할 수 없습니다.

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 20
      connection-timeout: 2000   # 커넥션을 2초 안에 못 받으면 실패 (기본값은 30초)
```

- **커넥션 풀 대기:** HikariCP의 `connectionTimeout` 기본값은 30초입니다. 풀이 고갈되면 요청이 30초씩 쌓입니다. 2~3초로 줄여 빨리 실패하게 합니다.
- **쿼리:** `@Transactional(timeout = 3)`이나 JDBC 쿼리 타임아웃을 둡니다.
- **외부 HTTP:** 연결 타임아웃과 읽기 타임아웃을 둘 다 둡니다. 기본값이 무한인 클라이언트가 많습니다.

```java
var factory = new SimpleClientHttpRequestFactory();
factory.setConnectTimeout(Duration.ofSeconds(1));
factory.setReadTimeout(Duration.ofSeconds(3));
RestClient pgClient = RestClient.builder()
        .baseUrl("https://pg.example.com")
        .requestFactory(factory)
        .build();
```

## 2. 동시 처리 상한

### 2-1. 서버 입구: 넘치면 바로 503 (로드 셰딩)

서버 전체에서 동시에 처리하는 요청 수를 세고, 넘치면 **기다리게 하지 않고 바로 거절**합니다. 기다리게 하면 그 요청도 메모리를 잡고 있기 때문입니다.

```java
@Component
public class ConcurrencyLimitFilter extends OncePerRequestFilter {

    private final Semaphore permits = new Semaphore(300);

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        if (!permits.tryAcquire()) {
            response.setStatus(HttpStatus.SERVICE_UNAVAILABLE.value());
            response.setHeader(HttpHeaders.RETRY_AFTER, "1");
            return;
        }
        try {
            chain.doFilter(request, response);
        } finally {
            permits.release();
        }
    }
}
```

- `Semaphore`는 가상 스레드와 잘 맞습니다. `acquire()`로 기다려도 캐리어를 붙잡지 않습니다(pinning 없음).
- `tryAcquire()`로 즉시 판단합니다. 짧게 기다리게 하고 싶으면 `tryAcquire(100, TimeUnit.MILLISECONDS)`를 씁니다.
- 거절된 클라이언트가 바로 다시 몰려오지 않도록 `Retry-After`를 함께 보냅니다.
- Tomcat의 `server.tomcat.max-connections`(기본 8192)로도 줄일 수 있지만, 이건 **연결 수**라서 쉬고 있는 keep-alive 연결까지 셉니다. 처리 중인 요청 수를 세는 필터가 더 정확합니다.
- 실제 서비스에서는 서버마다 거는 이 상한과 별개로, 앞단(API 게이트웨이, 인그레스)에서도 레이트 리밋을 겁니다.

### 2-2. 다음 단계별: 벌크헤드

**벌크헤드(bulkhead)**는 배의 격벽에서 온 이름입니다. 한 칸에 물이 차도 다른 칸은 멀쩡하도록 나눠 둡니다. 호출 대상마다 동시 호출 수를 따로 제한합니다.

- PG 결제 API가 느려져도 PG 호출용 자리 20개만 막히고, 상품 조회 같은 다른 API는 계속 돕니다.
- 서버 입구 상한 하나만 있으면, 느린 PG 호출이 상한 300개를 다 차지해서 서버 전체가 멈춥니다.

[Resilience4j](https://resilience4j.readme.io/)를 쓰면 설정으로 겁니다(의존성 `io.github.resilience4j:resilience4j-spring-boot3`와 `spring-boot-starter-aop`).

```yaml
resilience4j:
  bulkhead:
    instances:
      pgApi:
        max-concurrent-calls: 20   # PG 동시 호출은 20개까지
        max-wait-duration: 0       # 자리가 없으면 기다리지 않고 바로 실패
```

```java
@Bulkhead(name = "pgApi", type = Bulkhead.Type.SEMAPHORE)
public PaymentResult approve(PaymentRequest request) {
    return pgClient.post().uri("/approve").body(request).retrieve().body(PaymentResult.class);
}
```

가상 스레드에서는 `SEMAPHORE` 방식을 씁니다. 다른 방식인 `THREADPOOL`은 별도 플랫폼 스레드 풀에서 실행하는 방식이라 가상 스레드를 켠 의미가 줄어듭니다.

Spring Framework 7(Spring Boot 4)부터는 외부 라이브러리 없이 `@ConcurrencyLimit` 애노테이션으로도 메서드별 동시 실행 수를 제한할 수 있습니다(`@EnableResilientMethods` 필요).

### 2-3. DB: 커넥션 풀이 이미 벌크헤드입니다

- 커넥션 풀 크기(`maximum-pool-size`)가 곧 DB에 대한 동시 처리 상한입니다.
- 가상 스레드에서 할 일은 풀을 키우는 것이 아니라 위의 `connection-timeout`을 줄이는 것입니다. 풀을 키우면 부담이 DB로 넘어갈 뿐입니다.

### 상한은 몇으로 잡나: 리틀의 법칙

```
동시 처리 수 = 초당 처리량 × 평균 처리 시간
```

- 커넥션 20개, 쿼리 평균 50ms면 DB 쪽 최대 처리량은 20 ÷ 0.05 = **초당 400건**입니다.
- PG API 평균 응답 300ms에 초당 50건을 보내야 하면, 동시에 필요한 자리는 50 × 0.3 = **15개**입니다. 여유를 둬서 벌크헤드를 20으로 잡습니다.
- 서버 입구 상한은 이 다음 단계 상한들과 요청당 메모리를 보고 정합니다. 처음에는 예전 Tomcat 기본값(200) 근처에서 시작해 부하 테스트로 조정합니다.

## 3. 레이트 리미터: 시간당 호출 수

외부 API가 "초당 100건까지"처럼 호출 한도를 정해 둔 경우에 씁니다. 벌크헤드는 **동시에 몇 개**, 레이트 리미터는 **시간당 몇 번**을 셉니다.

```yaml
resilience4j:
  ratelimiter:
    instances:
      pgApi:
        limit-for-period: 100       # 1초에 100번까지
        limit-refresh-period: 1s
        timeout-duration: 0         # 한도를 넘으면 기다리지 않고 바로 실패
```

## 4. 서킷 브레이커: 고장 난 곳은 잠시 부르지 않습니다

다음 단계가 계속 실패하거나 느리면, 한동안 **부르지도 않고 바로 실패**시켜 우리 자원을 아끼고 상대가 회복할 시간을 줍니다.

**세 가지 상태**
1. **CLOSED(닫힘):** 평소 상태입니다. 호출을 그대로 보내고 결과를 셉니다.
2. **OPEN(열림):** 최근 호출 중 실패나 느린 호출 비율이 기준을 넘으면 열립니다. 이 동안은 호출 없이 바로 실패합니다.
3. **HALF_OPEN(반열림):** 일정 시간이 지나면 몇 건만 시험 삼아 보냅니다. 성공하면 다시 닫히고, 실패하면 다시 열립니다.

```yaml
resilience4j:
  circuitbreaker:
    instances:
      pgApi:
        sliding-window-size: 50                      # 최근 50건을 보고 판단
        failure-rate-threshold: 50                   # 실패가 50% 넘으면 열기
        slow-call-duration-threshold: 2s             # 2초 넘으면 느린 호출로 셈
        slow-call-rate-threshold: 50                 # 느린 호출이 50% 넘어도 열기
        wait-duration-in-open-state: 10s             # 10초 뒤 시험 호출
        permitted-number-of-calls-in-half-open-state: 5
```

```java
@CircuitBreaker(name = "pgApi", fallbackMethod = "approveFallback")
@Bulkhead(name = "pgApi", type = Bulkhead.Type.SEMAPHORE)
public PaymentResult approve(PaymentRequest request) { ... }

private PaymentResult approveFallback(PaymentRequest request, Throwable e) {
    return PaymentResult.pending(request.orderId());   // 결제 대기로 두고 나중에 확인
}
```

- **느린 호출 기준(`slow-call-*`)이 중요합니다.** 장애는 "에러"보다 "느려짐"으로 먼저 옵니다. 실패율만 보면 다음 단계가 30초씩 걸리는 동안 서킷이 안 열립니다.
- **fallback은 업무 의미에 맞게** 정합니다. 조회라면 캐시된 값, 결제라면 "대기" 상태로 두고 나중에 확인하는 식입니다. 결제를 "실패"로 확정해 버리면 실제로는 승인된 결제를 놓칠 수 있습니다.

## 5. 재시도: 조심해서

- 재시도는 부하를 **늘립니다.** 다음 단계가 과부하로 느린데 모두가 3번씩 재시도하면 부하가 3배가 됩니다(재시도 폭풍).
- 멱등한 호출만 재시도합니다. 결제 승인처럼 두 번 실행되면 안 되는 호출은 멱등 키 없이 재시도하지 않습니다.
- 지수 백오프에 무작위 지연(jitter)을 섞어서, 모두가 같은 순간에 다시 몰리지 않게 합니다.
- 서킷이 열려 있을 때는 재시도하지 않습니다.

## 쌓는 순서

Resilience4j 애노테이션을 한 메서드에 여러 개 붙이면 기본으로 아래 순서로 감쌉니다.

```
Retry ( CircuitBreaker ( RateLimiter ( TimeLimiter ( Bulkhead ( 실제 호출 ) ) ) ) )
```

- 가장 안쪽의 벌크헤드가 자리를 먼저 확보합니다.
- 서킷 브레이커는 그 결과(실패, 느림, 벌크헤드 거절)를 셉니다.
- 재시도는 가장 바깥에서 전체를 다시 시도합니다.

`TimeLimiter`는 `CompletableFuture` 같은 비동기 반환에만 적용됩니다. 동기 호출은 1번처럼 HTTP 클라이언트 자체의 타임아웃으로 시간을 제한합니다.

## 정리: 가상 스레드를 켤 때 할 일

1. 모든 기다림에 타임아웃을 둡니다. 커넥션 풀 대기, 쿼리, 외부 HTTP 연결과 읽기입니다.
2. 서버 입구에 동시 처리 상한을 두고, 넘치면 503과 `Retry-After`로 바로 거절합니다.
3. 외부 API마다 벌크헤드(SEMAPHORE)로 동시 호출 수를 나눕니다. DB는 커넥션 풀이 그 역할을 합니다.
4. 호출 한도가 있는 외부 API에는 레이트 리미터를 둡니다.
5. 외부 API마다 서킷 브레이커를 두고, 실패율과 느린 호출 비율을 둘 다 봅니다.
6. 재시도는 멱등한 호출만, 백오프와 jitter를 섞어서 합니다.
7. 처리 중인 요청 수, 거절 수(503), 서킷 상태, 벌크헤드 거절 수를 지표로 봅니다. 거절이 늘면 상한을 올리기 전에 다음 단계가 느려졌는지부터 봅니다.

## 출처

- [Resilience4j 문서](https://resilience4j.readme.io/): Bulkhead, CircuitBreaker, RateLimiter, Retry, 애노테이션 적용 순서
- [HikariCP 설정](https://github.com/brettwooldridge/HikariCP#gear-configuration-knobs-baby): `connectionTimeout` 기본 30초
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444): 가상 스레드는 풀로 관리하지 말고, 동시성 제한은 `Semaphore`로 하라는 권고
