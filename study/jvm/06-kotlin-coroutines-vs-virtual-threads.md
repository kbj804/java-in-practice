# 06. Kotlin 코루틴 vs 가상 스레드

[04. 가상 스레드](04-virtual-threads.md)를 읽었다고 가정합니다. Kotlin 서버에서 "가상 스레드를 쓰나, 코루틴을 쓰나"가 헷갈려서 정리한 노트입니다.

## Kotlin과 Java는 같은 JVM 위에서 돕니다

Kotlin 코드도 컴파일하면 Java와 같은 바이트코드(`.class`)가 됩니다. 그래서 아래는 언어와 관계없이 같습니다.

- JVM, GC, Heap 구조
- 라이브러리: Spring, JPA, HikariCP를 그대로 씁니다
- 운영 문제: [05번 노트](05-jvm-upgrade-periodic-crash.md)의 OOMKilled, GC, 에이전트 문제는 Kotlin 서버에도 똑같이 생깁니다

다른 것은 언어 문법과 기능입니다.

| | Java | Kotlin |
|---|---|---|
| null | 아무 참조나 null이 될 수 있음 | `String`과 `String?`을 타입으로 구분해서, null 실수를 컴파일할 때 잡음 |
| 데이터 클래스 | `record` 또는 Lombok | `data class` |
| 비동기 | 가상 스레드(JDK 21), `CompletableFuture` | **코루틴**(`suspend fun`). 가상 스레드도 JVM 기능이라 그대로 쓸 수 있음 |

## 한 줄 요약

**둘 다 "기다리는 동안 OS 스레드를 놓아준다"는 같은 문제를 풉니다. 차이는 놓아주는 지점을 누가 정하느냐입니다.**

- **코루틴:** 개발자가 `suspend`로 표시한 지점에서만 놓아줍니다. Python의 **asyncio**(`async`/`await`)와 같은 방식입니다.
- **가상 스레드:** JVM이 I/O 지점에서 알아서 놓아줍니다. 코드는 평범한 블로킹 코드 그대로입니다. Python의 **gevent**와 같은 방식입니다.

나머지 차이는 대부분 여기서 나옵니다.

| | 코루틴 | 가상 스레드 |
|---|---|---|
| 놓아주는 지점 | `suspend` 함수 호출 지점(개발자가 표시) | 블로킹 I/O 지점(JVM이 처리) |
| 함수 색깔 | `suspend fun`은 코루틴 안에서만 부를 수 있음 | 구분 없음 |
| 블로킹 라이브러리(JDBC 등) | 그냥 부르면 아래 스레드를 막음 → 별도 스레드 풀로 보내야 함 | 그냥 불러도 됨(단, JDK 21~23의 pinning 주의) |
| 구현 | 컴파일러가 함수를 상태 기계로 바꿈. 스택을 따로 저장하지 않음 | JVM이 스레드 스택을 Heap에 복사해 두었다가 되살림 |
| 취소 | 구조적 동시성이 기본. 부모가 취소되면 자식도 취소 | `interrupt()` 기반. 구조적 동시성 API는 JDK 21에서 아직 미리보기 |
| 정식 출시 | 2018년(Kotlin 1.3) | 2023년(JDK 21) |

## 차이 1: 블로킹 라이브러리는 별도 스레드 풀로

코루틴은 `suspend` 지점에서만 스레드를 놓아줍니다. JDBC 같은 블로킹 호출은 `suspend`가 아니라서, 부르는 순간 **코루틴이 올라탄 스레드 자체가 멈춥니다.**

```kotlin
// 나쁜 예: CPU 작업용 스레드(코어 수만큼)를 JDBC 대기로 붙잡음
suspend fun getPost(id: Long): Post = withContext(Dispatchers.Default) {
    postRepository.findById(id)   // 블로킹 JDBC
}

// 좋은 예: 블로킹 전용 풀로 보냄
suspend fun getPost(id: Long): Post = withContext(Dispatchers.IO) {
    postRepository.findById(id)
}
```

- `Dispatchers.Default`는 CPU 코어 수만큼의 스레드로 계산 작업을 돌리는 풀입니다. 여기서 블로킹하면 코어 수만큼만 막혀도 서버 전체가 멈춥니다. **가상 스레드의 pinning과 같은 모양의 사고입니다.**
- `Dispatchers.IO`는 블로킹 호출용 풀입니다. 기본 크기는 **64개**(코어가 더 많으면 코어 수)입니다.
- 그래서 `Dispatchers.IO`의 64개가 사실상 **블로킹 호출의 동시 처리 상한**이 됩니다. 플랫폼 스레드 시절 Tomcat 스레드 200개와 같은 역할입니다. 상한이 있다는 점은 오히려 안전장치이기도 합니다([Spring 03. 동시 처리 상한](../spring/03-concurrency-limits.md)).
- 호출 대상마다 상한을 나누려면 `Dispatchers.IO.limitedParallelism(20)`처럼 쪼갭니다. 벌크헤드와 같은 생각입니다.

가상 스레드에서는 이 구분이 필요 없습니다. JDBC를 그냥 불러도 JVM이 캐리어를 놓아줍니다. 대신 상한이 사라지므로 직접 둬야 합니다.

## 차이 2: 함수 색깔

```kotlin
suspend fun fetchProfile(): Profile { ... }

fun handler() {
    fetchProfile()          // 컴파일 오류: suspend 함수는 코루틴 안에서만
}
```

- `suspend`는 호출하는 쪽으로 번집니다. 한 곳을 `suspend`로 바꾸면 그 함수를 부르는 함수도 모두 `suspend`가 되어야 합니다. Python에서 `async def`가 위로 번지는 것과 같습니다.
- 가상 스레드는 함수 색깔이 없어서, 기존 블로킹 코드를 고치지 않고 옵션만 켜면 됩니다. Spring MVC + JPA 같은 블로킹 스택에서 가상 스레드가 쉬운 이유입니다.

## 차이 3: 취소와 타임아웃

코루틴은 **구조적 동시성**이 기본입니다. 부모 코루틴이 취소되거나 타임아웃이 나면 그 안에서 시작한 자식 코루틴이 모두 같이 취소됩니다.

```kotlin
val feed = withTimeout(500) {          // 500ms 안에 못 끝나면 전부 취소
    val posts = async { loadPosts() }
    val ads = async { loadAds() }
    Feed(posts.await(), ads.await())
}
```

함정이 있습니다. **코루틴 취소는 협조 방식이라, 블로킹 호출은 멈추지 않습니다.**

- `withTimeout`이 났어도 `Dispatchers.IO`에서 돌던 JDBC 쿼리는 끝날 때까지 계속 돕니다. 커넥션과 IO 스레드도 계속 붙잡습니다.
- 그래서 블로킹 호출에는 자체 타임아웃을 따로 겁니다. JDBC 쿼리 타임아웃, HTTP 읽기 타임아웃입니다.
- 중단 가능한 블로킹 호출이라면 `runInterruptible(Dispatchers.IO) { ... }`로 감싸서, 취소될 때 스레드 interrupt를 보내게 할 수 있습니다.

가상 스레드는 JDK 21 기준으로 이런 구조적 취소가 기본이 아닙니다(`StructuredTaskScope`는 미리보기 기능). 취소는 `Future.cancel(true)`나 `interrupt()`로 직접 합니다.

## 둘을 섞을 수도 있습니다

코루틴의 실행 장소(디스패처)를 가상 스레드로 만들 수 있습니다.

```kotlin
val virtualThreads = Executors.newVirtualThreadPerTaskExecutor().asCoroutineDispatcher()

suspend fun getPost(id: Long): Post = withContext(virtualThreads) {
    postRepository.findById(id)   // 블로킹이지만 가상 스레드라 OS 스레드를 놓아줌
}
```

- 코루틴의 구조적 취소와 가상 스레드의 "블로킹 그대로" 장점을 함께 얻습니다.
- 대신 `Dispatchers.IO`의 64개 상한이 사라지므로, 동시 처리 상한을 직접 둬야 합니다.
- JDK 21~23에서는 pinning 주의점도 그대로 따라옵니다.

## 어떤 걸 쓰나

| 스택 | 보통의 선택 |
|---|---|
| Kotlin + WebFlux, Ktor 같은 논블로킹 스택 | 코루틴. 라이브러리가 이미 `suspend`를 지원하므로 가상 스레드는 거의 의미 없음 |
| Kotlin + Spring MVC + JPA(JDBC) 같은 블로킹 스택 | 가상 스레드를 켜는 것이 가장 간단. 병렬 호출이 필요한 곳만 코루틴 |
| Java + Spring MVC | 가상 스레드 |

어느 쪽이든 공통으로 할 일은 같습니다.

1. **모든 기다림에 타임아웃**을 둡니다. 코루틴의 `withTimeout`만 믿지 말고 블로킹 호출 자체에도 겁니다.
2. **동시 처리 상한**을 확인합니다. 코루틴은 `Dispatchers.IO` 크기, 가상 스레드는 직접 둔 `Semaphore`와 벌크헤드입니다.
3. **아래 스레드를 붙잡는 지점**을 찾습니다. 코루틴은 `Default`에서의 블로킹, 가상 스레드는 `synchronized` 안의 I/O입니다.

## 출처

- [Kotlin 문서: Coroutines](https://kotlinlang.org/docs/coroutines-overview.html), [Coroutine context and dispatchers](https://kotlinlang.org/docs/coroutine-context-and-dispatchers.html), [Cancellation and timeouts](https://kotlinlang.org/docs/cancellation-and-timeouts.html)
- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444), [JEP 453: Structured Concurrency (Preview)](https://openjdk.org/jeps/453)
