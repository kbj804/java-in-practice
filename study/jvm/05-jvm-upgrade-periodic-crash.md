# 05. JVM 메이저 버전을 올린 직후 서버가 몇 시간마다 죽는다면

면접 질문으로 받은 상황을 정리한 노트입니다. [02. 세대별 GC](02-generational-gc.md), [03. G1 vs ZGC](03-g1-vs-zgc.md)를 읽었다고 가정합니다.

> JDK 8 → 17로 올렸더니 배포 직후는 멀쩡한데, 몇 시간마다 Pod가 재시작됩니다. 원인이 뭘까요?

## 한 줄 요약

**"몇 시간 주기"는 무언가가 일정한 속도로 쌓이다가 한도에 닿는다는 신호입니다.** 버전 업그레이드 직후라면 쌓이는 곳은 Heap보다 **Heap 밖(네이티브 메모리)**인 경우가 많습니다. 그래서 원인을 추측하기 전에 **어떻게 죽었는지**부터 확인합니다.

## 1단계: 어떻게 죽었나

죽은 방식에 따라 다음에 볼 곳이 완전히 달라집니다.

| 증상 | 뜻 | 어디서 보나 |
|---|---|---|
| exit code 137, `OOMKilled` | 컨테이너 메모리 한도를 넘어 커널이 SIGKILL로 죽임. JVM은 아무 로그도 못 남김 | `kubectl describe pod`의 Last State |
| `java.lang.OutOfMemoryError` | JVM 안에서 Heap이나 Metaspace가 바닥남 | 애플리케이션 로그 |
| exit code 134, `hs_err_pid*.log` | JVM 자체가 크래시함(SIGABRT). 네이티브 코드나 JIT 쪽 문제 | 작업 디렉터리의 hs_err 파일 |
| `Liveness probe failed` 이벤트 | 죽은 게 아니라 응답이 늦어 쿠버네티스가 재시작함 | Pod 이벤트 |

주의할 점이 두 가지 있습니다.

- **`OutOfMemoryError`가 나도 프로세스가 바로 죽지는 않습니다.** 예외를 던진 스레드만 죽고, 서버는 반쯤 고장 난 채로 계속 떠 있을 수 있습니다. 확실히 죽이고 싶으면 `-XX:+ExitOnOutOfMemoryError`를 켭니다.
- **OOMKilled는 JVM 입장에서 "갑자기 사라진" 것이라** 애플리케이션 로그에 아무 흔적이 없습니다. "로그가 깨끗한데 재시작됐다"면 먼저 OOMKilled를 의심합니다.

**주방 비유:** 주방(JVM) 안에서 접시가 모자라 요리사가 포기하는 것(Java OOM)과, 건물 관리인(커널)이 "전기 너무 많이 쓴다"며 주방 전원을 내려 버리는 것(OOMKilled)은 다른 사고입니다. 두 번째는 주방 일지에 아무것도 안 남습니다.

## 2단계: 가능성 높은 원인

### 1) Heap 밖 메모리가 늘어서 OOMKilled (가장 흔함)

컨테이너 한도는 **Heap만이 아니라 JVM 프로세스 전체(RSS)**에 걸립니다.

```
RSS = Heap + Metaspace + Code Cache + 스레드 스택 + GC 자료구조
      + Direct Buffer + JVM 내부 + 네이티브 라이브러리(malloc)
```

메이저 업그레이드는 이 중 Heap 밖 항목의 기본값을 많이 바꿉니다.

- **기본 GC가 바뀝니다.** JDK 8의 기본은 Parallel GC, JDK 9부터는 G1입니다([JEP 248](https://openjdk.org/jeps/248)). G1은 Remembered Set 같은 자료구조([03번 노트](03-g1-vs-zgc.md)) 때문에 Parallel보다 네이티브 메모리를 더 씁니다. 같은 `-Xmx`라도 RSS가 커집니다.
  - 덧붙여 CPU 2개 미만이거나 메모리 1792MB 미만인 컨테이너에서는 JVM이 G1 대신 Serial GC를 고릅니다. 버전보다 Pod 크기에 따라 GC가 달라질 수도 있습니다.
- **컨테이너 메모리를 읽는 방식이 바뀝니다.** cgroup v2 인식은 JDK 15부터 들어갔고 11과 8에는 나중에 백포트됐습니다. 업그레이드 전후로 JVM이 보는 "전체 메모리"가 달라지면, `-Xmx` 없이 `MaxRAMPercentage`(기본 25%)에 기대던 Heap 크기도 같이 달라집니다.
- **Metaspace에는 기본 상한이 없습니다.** 클래스가 계속 만들어지면(프록시, 리플렉션, 아래 2번) 한도 없이 늘다가 컨테이너 한도에 먼저 닿습니다.
- **Direct Buffer:** Netty 같은 라이브러리가 Heap 밖에 잡는 버퍼입니다. 상한(`MaxDirectMemorySize`)의 기본값은 대략 Heap 최대 크기와 같아서, Heap과 합치면 한도를 쉽게 넘습니다.
- **glibc malloc arena:** 스레드가 많으면 glibc가 스레드 그룹마다 메모리 덩어리를 따로 잡아, 실제로 쓰는 양보다 RSS가 커집니다. JVM 내부 도구로는 잘 안 보여서 마지막에 의심하는 곳입니다(`MALLOC_ARENA_MAX`로 줄임).

**판별:** Heap 그래프는 평평한데 RSS 그래프만 계단처럼 올라가다 한도에서 끊기면 이 경우입니다.

### 2) 새 JDK와 안 맞는 에이전트·라이브러리

**"JVM만 올리고 APM 에이전트는 그대로"**인 경우가 아주 흔합니다.

- APM 에이전트(Datadog, Pinpoint, New Relic 등)와 바이트코드를 다루는 라이브러리(ByteBuddy, ASM, cglib, 옛 Lombok)는 JDK 내부 구조에 기대서 동작합니다.
- 버전이 낮으면 클래스를 계속 다시 변환하면서 Metaspace가 새거나, 네이티브 쪽에서 크래시(hs_err)가 납니다.
- JDK 17부터는 JDK 내부 API 접근이 기본으로 막힙니다([JEP 403](https://openjdk.org/jeps/403)). 이건 보통 시작할 때나 특정 코드를 탈 때 바로 터져서 "몇 시간 주기"와는 모양이 다르지만, 업그레이드 체크리스트에는 같이 넣습니다.

**판별:** 에이전트를 빼고 띄웠을 때 증상이 사라지는지 봅니다.

### 3) GC 동작이 바뀌어 멈춤이 길어짐

- G1에서 Region 절반보다 큰 객체(Humongous)를 자주 만들면 Old Region이 조각나고, 결국 Full GC로 떨어집니다([03번 노트의 "실패하면"](03-g1-vs-zgc.md)).
- Full GC 멈춤이 liveness probe 제한 시간보다 길면 쿠버네티스가 재시작합니다. 밖에서 보면 "주기적으로 죽는" 것처럼 보입니다.

**판별:** Pod 이벤트에 `Liveness probe failed`가 있고, GC 로그(`-Xlog:gc*`)의 긴 멈춤과 시각이 겹칩니다.

### 4) 진짜 Heap 누수

- 업그레이드하면서 같이 올라간 라이브러리의 동작 변화로 캐시나 `ThreadLocal`이 해제되지 않는 경우입니다.
- 1번과 달리 **Heap 그래프 자체가** Full GC 뒤에도 내려오지 않고 계단처럼 올라갑니다.

### 덤: 주기가 너무 일정하면

"정확히 3시간마다"처럼 주기가 칼같이 맞으면 누수보다 **그 시각에 도는 일**을 먼저 봅니다. 배치, 스케줄러, 캐시 전체 갱신이 한 번에 큰 메모리를 잡는 경우입니다. 정산 배치가 돌 때만 API 서버가 같이 느려지는 것과 같은 모양입니다.

## 3단계: 원인 좁히기

1. **Heap 사용량과 RSS를 한 그래프에 겹쳐 봅니다.** 어느 쪽이 오르는지로 1번(네이티브)과 4번(Heap)이 갈립니다.
2. **네이티브가 의심되면 NMT(Native Memory Tracking)를 켭니다.**
   ```bash
   # 기동 옵션
   -XX:NativeMemoryTracking=summary

   # 기동 직후 기준점을 찍고
   jcmd <pid> VM.native_memory baseline
   # 몇 시간 뒤 차이를 봄
   jcmd <pid> VM.native_memory summary.diff
   ```
   어느 영역(Class, Thread, GC, Internal 등)이 늘었는지 바로 나옵니다. NMT 합계보다 RSS가 훨씬 크면, NMT가 못 보는 malloc arena나 네이티브 라이브러리를 의심합니다.
3. **Heap이 의심되면 죽을 때 덤프를 남깁니다.**
   ```bash
   -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/dumps
   ```
   덤프는 MAT 같은 분석 도구로 열어 가장 많이 잡혀 있는 객체를 봅니다.
4. **조용히 죽는 대신 이름을 남기게 상한을 겁니다.**
   ```bash
   -XX:MaxMetaspaceSize=256m -XX:MaxDirectMemorySize=256m
   ```
   이러면 컨테이너가 OOMKilled로 조용히 죽기 전에 JVM이 `OutOfMemoryError: Metaspace`처럼 **범인의 이름이 들어간 예외**를 던집니다.
5. **비교 실험을 합니다.**
   - 이전 JDK로 롤백해서 재현되는지 봅니다.
   - 새 JDK에서 GC만 예전 것(`-XX:+UseParallelGC`)으로 돌려 봅니다.
   - APM 에이전트만 빼 봅니다.

   하나씩 바꿔 가며 어느 변화가 원인인지 좁힙니다.

## 예방: 업그레이드 체크리스트

- `-Xmx`를 명시하거나 `MaxRAMPercentage`를 정하고, **컨테이너 한도에서 Heap을 뺀 나머지가 Heap 밖 메모리에 충분한지** 계산합니다. 보통 한도의 25~35%는 남겨 둡니다.
- GC를 명시합니다. 업그레이드에서 GC가 바뀌는 걸 원하지 않으면 예전 GC를 옵션으로 고정하고, 바꾸는 건 별도 작업으로 나눕니다.
- APM 에이전트와 바이트코드 라이브러리를 새 JDK 지원 버전으로 먼저 올립니다.
- 카나리 배포로 일부 Pod만 먼저 올리고, **RSS 추세를 최소 하루** 봅니다. 배포 직후 몇 분 동안은 멀쩡하기 때문에 짧은 검증으로는 못 잡습니다.
- `ExitOnOutOfMemoryError`, `HeapDumpOnOutOfMemoryError`, NMT summary를 평소에도 켜 둡니다(NMT summary는 부하가 작습니다).

## 면접에서 답할 때

> 먼저 어떻게 죽었는지부터 구분합니다. exit code 137이면 컨테이너 한도에 걸린 OOMKilled, 로그에 OutOfMemoryError가 있으면 JVM 안의 OOM, hs_err 파일이 있으면 JVM 크래시, probe 실패 이벤트면 긴 GC 멈춤입니다. 버전 업그레이드 직후 몇 시간 주기라면 가장 먼저 OOMKilled를 의심합니다. 기본 GC가 Parallel에서 G1로 바뀌거나 Metaspace, Direct Buffer처럼 Heap 밖 메모리가 늘어나는 경우가 많기 때문입니다. Heap과 RSS 그래프를 겹쳐서 어느 쪽이 오르는지 보고, RSS만 오르면 NMT로 영역을 좁힙니다. 옛 APM 에이전트가 새 JDK와 안 맞는 경우도 흔해서 에이전트 버전도 같이 확인합니다.
