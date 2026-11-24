# 04. 가상 스레드 vs 플랫폼 스레드 (JDK 21)

요청 하나에 스레드 하나를 쓰는 방식은 그대로 두고, 스레드를 싸게 만든 것이 가상 스레드입니다. 이 노트는 무엇이 싸졌는지, 어디서 막히는지(pinning, 커넥션 풀)를 그림과 실험으로 정리합니다.

[![플랫폼 스레드와 가상 스레드 그림](figures/virtual-threads/vt-light.png)](https://kbj804.github.io/java-in-practice/study/jvm/figures/virtual-threads/vt-light.html)

그림을 누르면 움직이는 버전이 열립니다([다크 테마](https://kbj804.github.io/java-in-practice/study/jvm/figures/virtual-threads/vt.html)).
- 왼쪽: 플랫폼 스레드 풀
- 오른쪽: 캐리어 스레드, 큐, 힙, 커넥션 풀
- 무엇이 무엇인지는 그림 아래 범례에 있습니다.
- 단계는 6개입니다: 플랫폼 스레드 → mount → 블로킹과 unmount → 다른 캐리어에 remount → pinning → 커넥션 풀 상한.
- 클릭, ← → 키, 1~6 숫자 키로 단계를 옮깁니다.
- 레인은 4개로 줄였고, 시간 축은 설명용입니다. 실제 숫자는 아래 실험에 있습니다.

## 플랫폼 스레드

- `new Thread()`나 스레드 풀이 만드는 보통 스레드입니다. OS 스레드와 1:1로 묶입니다.
- 스레드마다 스택을 따로 예약합니다. 이 맥(JDK 21.0.13, arm64)에서 기본값은 `ThreadStackSize = 2048`(KB), 즉 2MB입니다.
  ```sh
  java -XX:+PrintFlagsFinal -version | grep ThreadStackSize
  ```
- I/O를 기다리는 동안에도 스레드는 그 요청에 묶여 있습니다. CPU는 놀아도 스레드는 못 씁니다.
- 그래서 동시에 처리할 수 있는 요청 수가 스레드 수에서 막힙니다. 스레드를 무작정 늘릴 수도 없습니다. OS 한도와 메모리에 걸립니다. [실험 1](#실험-1-작업-10000개가-각각-1초씩-기다릴-때)에서 8,162개째에 실패했습니다.

## 가상 스레드

- JDK가 관리하는 스레드입니다. OS 스레드와 1:1이 아닙니다.
- 실제로 실행할 때만 **캐리어 스레드**(평범한 플랫폼 스레드)에 올라탑니다.
- 기본 스케줄러는 **FIFO 모드의 `ForkJoinPool`**입니다. 기본값은 다음과 같습니다(JDK 21 `VirtualThread.createDefaultScheduler`).

| 속성 | 기본값 | 이 맥 |
|---|---|---|
| `jdk.virtualThreadScheduler.parallelism` (캐리어 수) | 코어 수 | 10 |
| `jdk.virtualThreadScheduler.maxPoolSize` | max(parallelism, 256) | 256 |
| `jdk.virtualThreadScheduler.minRunnable` | max(parallelism / 2, 1) | 5 |

### 동작 순서

1. **mount:** 가상 스레드는 스케줄러 큐에 섰다가, 비어 있는 캐리어에 올라가 실행됩니다.
2. **unmount:**
   - `sleep`, 소켓 읽기, `LockSupport.park` 같은 블로킹을 만나면 캐리어에서 내려옵니다.
   - 이때 스택 프레임은 힙의 **stack chunk** 객체로 옮겨집니다. 필요한 프레임만큼만 차지하므로 2MB를 미리 잡지 않습니다.
   - 비워진 캐리어는 곧바로 큐의 다음 가상 스레드를 실행합니다.
3. **remount:** I/O가 끝나면 가상 스레드는 다시 큐에 섭니다. 그리고 그때 비어 있는 **아무 캐리어**에 올라갑니다. 처음과 다른 캐리어일 수 있습니다. 코드에서 `Thread.currentThread()`는 늘 같은 가상 스레드를 돌려주므로 이 차이는 보이지 않습니다.

코드에서 보면 블로킹 코드를 그대로 씁니다. `Thread.sleep`도 JDBC 호출도 그대로입니다. 내려오고 올라가는 일은 JDK가 합니다.

### Python과 비교

- Python의 `ThreadPoolExecutor`는 플랫폼 스레드 방식입니다. GIL 때문에 CPU 일은 한 번에 하나만 돌지만, I/O 동안 스레드를 붙잡는 구조는 같습니다.
- `asyncio`도 I/O 동안 실행을 양보한다는 점에서 가상 스레드와 같습니다. 다만 `async`/`await`를 코드에 직접 적어야 하고, 블로킹 함수를 부르면 이벤트 루프 전체가 멈춥니다.
- 가상 스레드는 양보를 JDK가 대신 합니다. 그래서 기존 블로킹 코드를 그대로 쓸 수 있습니다. 대신 아래 pinning처럼 JDK가 대신 못 해 주는 경우를 알아야 합니다.

## pinning: 캐리어를 붙잡는 경우

- 다음 두 경우에는 블로킹해도 unmount하지 못하고 **캐리어를 붙잡습니다.**
  - `synchronized` 블록이나 메서드 안에서 블로킹할 때
  - 네이티브 메서드나 foreign function 안에서 블로킹할 때
- 캐리어가 다 붙잡히면 다른 가상 스레드는 CPU가 놀아도 실행되지 못합니다.
- JDK 21에서는 `-Djdk.tracePinnedThreads=short`(또는 `full`)로 pinning이 일어난 곳을 볼 수 있습니다.
- 해결은 블로킹하는 임계 구역을 `ReentrantLock`으로 바꾸는 것입니다.
- **JDK 24([JEP 491](https://openjdk.org/jeps/491))부터는 `synchronized`에서도 unmount합니다.** 네이티브 프레임 pinning은 남아 있습니다.

보상(compensation) 동작도 있습니다.
- 파일 I/O(`FileInputStream.read` 등)와 `Object.wait()`는 JDK 21에서 unmount하지 못합니다.
- 이때 JDK가 스케줄러의 캐리어를 임시로 하나 늘려서 버팁니다. 소스에서는 `jdk.internal.misc.Blocker`가 `ForkJoinPool`의 compensated block을 엽니다.
- 그래서 parallelism보다 캐리어가 잠시 많아질 수 있고, 상한은 `maxPoolSize`(256)입니다.

## 커넥션 풀은 여전히 상한

- 가상 스레드는 **스레드**를 싸게 만들 뿐, DB 커넥션을 늘려 주지 않습니다.
- HikariCP 기본 `maximumPoolSize`는 10입니다. 가상 스레드 1,000개가 동시에 DB를 쓰려 해도 동시에 쿼리하는 것은 10개입니다.
- 나머지는 커넥션을 기다립니다. 기다리는 동안 캐리어는 비켜 주므로 CPU는 놀고, 처리량은 풀 크기가 정합니다.
- [Spring 02. 커넥션 풀 고갈](../spring/02-connection-pool.md)의 결론과 같습니다. 가상 스레드로 바꾸면 동시 요청이 더 많이 들어오고, 같은 풀 앞의 줄만 길어집니다. 트랜잭션 안의 외부 호출처럼 커넥션을 오래 쥐는 코드부터 고쳐야 합니다.
- 반대로, 풀 앞에서 기다리는 비용은 싸집니다. 플랫폼 스레드였다면 기다리는 요청마다 스레드 하나를 쥐고 있었을 것입니다.

## 실험

코드는 [`virtual-thread-demo/`](virtual-thread-demo/)에 있습니다. 모두 단일 파일이라 `java 파일명.java`로 바로 돌아갑니다. 환경은 JDK 21.0.13(Temurin)과 10코어 맥입니다. RSS는 `/usr/bin/time -l`의 maximum resident set size입니다.

### 실험 1: 작업 10,000개가 각각 1초씩 기다릴 때

[`SleepDemo.java`](virtual-thread-demo/SleepDemo.java)

```sh
/usr/bin/time -l java SleepDemo.java platform   # 플랫폼 스레드 200개 고정 풀
/usr/bin/time -l java SleepDemo.java per-task   # 작업마다 플랫폼 스레드
/usr/bin/time -l java SleepDemo.java virtual    # 작업마다 가상 스레드
```

| 방식 | 끝난 작업 | 걸린 시간 | 최대 플랫폼 스레드 수 | 최대 RSS |
|---|---|---|---|---|
| 플랫폼 스레드 풀 200 | 10,000 | 50,374 ms | 206 | 162 MB |
| 작업마다 플랫폼 스레드 | **8,162에서 실패** | – | 8,168 | 514 MB |
| 작업마다 가상 스레드 | 10,000 | **1,051 ms** | 17 | 142 MB |

- 풀 200은 200개씩 50번 돌아서 50초가 걸렸습니다.
- 작업마다 플랫폼 스레드를 만들면 `OutOfMemoryError: unable to create native thread`로 실패합니다. 이 맥의 프로세스당 스레드 한도(`kern.num_taskthreads = 8192`)에 걸렸습니다.
- 가상 스레드는 1초 남짓에 끝났습니다. 최대 플랫폼 스레드 17개는 캐리어 10개와 JVM 내부 스레드입니다.

### 실험 2: pinning

[`PinningDemo.java`](virtual-thread-demo/PinningDemo.java): 가상 스레드 100개가 **각자 자기 락**을 잡고 100ms 기다립니다. 락끼리 경쟁은 없습니다.

```sh
java -Djdk.tracePinnedThreads=short PinningDemo.java sync
java -Djdk.tracePinnedThreads=short PinningDemo.java lock
```

```
VirtualThread[#33]/runnable@ForkJoinPool-1-worker-5 reason:MONITOR
    PinningDemo.lambda$main$0(PinningDemo.java:21) <== monitors:1
sync: 100 virtual threads x 100 ms, 1080 ms (carriers 10)
lock: 100 virtual threads x 100 ms, 110 ms (carriers 10)
```

- `synchronized` 안에서 sleep하면 캐리어 10개가 붙잡힙니다. 그래서 10개씩 10번, 약 1초가 걸렸습니다. 추적 로그에 `reason:MONITOR`가 찍혔습니다.
- `ReentrantLock`은 unmount하므로 100개가 한꺼번에 기다려 110ms에 끝났습니다. 추적 로그는 없습니다.

### 실험 3: 커넥션 풀 흉내

[`PoolLimitDemo.java`](virtual-thread-demo/PoolLimitDemo.java): `Semaphore(10)`을 커넥션 풀처럼 씁니다. 가상 스레드 1,000개가 각각 100ms씩 잡습니다.

```
1000 virtual threads, pool 10, 100 ms each: 10740 ms, max waiting 987
```

- 1,000 × 100ms ÷ 10 = 10초 이론값대로 걸렸습니다.
- 가장 많을 때 987개가 풀 앞에서 기다렸습니다. 스레드는 충분해도 처리량은 풀 크기에서 막힙니다.

## 언제 쓰나

**잘 맞는 경우**
- 요청 하나가 DB, 외부 API, 파일을 기다리는 시간이 대부분인 서버
- 블로킹 코드를 그대로 두고 동시 처리 수를 늘리고 싶을 때
- Spring Boot 3.2 이상에서는 `spring.threads.virtual.enabled=true`로 Tomcat 요청 처리에 가상 스레드를 씁니다.

**얻는 게 없거나 조심할 경우**
- CPU 계산이 대부분인 작업. 캐리어 수(코어 수) 이상으로 빨라지지 않습니다.
- 가상 스레드를 풀에 넣어 재사용하지 않습니다. 작업마다 새로 만듭니다(`newVirtualThreadPerTaskExecutor`). 동시 실행 수를 제한하려면 `Semaphore`를 씁니다.
- JDK 21에서 `synchronized` 안에 블로킹 I/O가 있는 라이브러리를 쓰면 pinning이 생깁니다. `-Djdk.tracePinnedThreads`로 확인하고, 가능하면 JDK 24 이상을 씁니다.
- 가상 스레드 수만큼 `ThreadLocal`이 만들어집니다. 큰 객체를 `ThreadLocal`에 캐시하는 코드는 메모리를 많이 씁니다.
- DB 커넥션, 외부 API rate limit 같은 하류 자원은 그대로입니다. 위의 커넥션 풀 절을 보세요.

## 출처

- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444)
- [JEP 491: Synchronize Virtual Threads without Pinning](https://openjdk.org/jeps/491)
- [Oracle Java 21 문서: Virtual Threads](https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html)
- JDK 21 소스: `java.lang.VirtualThread.createDefaultScheduler`, `jdk.internal.misc.Blocker`(Temurin 21.0.13의 `lib/src.zip`)
