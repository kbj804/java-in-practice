# 02. Heap을 세대로 나누는 이유와 Minor GC·Full GC (식당 주방 비유)

[01. JVM은 어떻게 동작하나](01-how-jvm-works.md)의 ⑤ GC를 자세히 본 노트입니다. 주방 비유도 그대로 이어 갑니다.

## 왜 세대를 나누나

대부분의 객체는 만들어지자마자 버려집니다. 요청 하나를 처리하며 만든 DTO, 문자열, 임시 리스트가 그렇습니다. 오래 사는 객체는 적습니다. 이것을 **약한 세대 가설(weak generational hypothesis)**이라고 합니다.

그래서 Heap을 둘로 나눕니다.
- **Young:** 갓 만든 객체가 들어갑니다. 자주, 빠르게 청소합니다.
- **Old:** 오래 살아남은 객체가 들어갑니다. 가끔 청소합니다.

주방 비유: 손님상에서 바로 돌아오는 접시는 배식대 근처에서 빨리빨리 치우고, 오래 쓰는 큰 냄비는 안쪽 선반에 두고 가끔 정리합니다.

## Heap의 구역

| 구역 | 하는 일 | 기본 비율 (JDK 21 확인값) | 주방 비유 |
|---|---|---|---|
| **Eden** | 새 객체가 처음 만들어지는 곳 | Young의 8/10 (`SurvivorRatio=8`) | 배식대. 갓 나온 접시가 놓임 |
| **Survivor 0 / 1** | Minor GC에서 살아남은 객체가 잠시 머무는 곳. 둘 중 하나는 늘 비어 있음 | 각각 Young의 1/10 | 임시 선반 두 개. 번갈아 씀 |
| **Old** | 오래 살아남은 객체 | Heap의 2/3 (`NewRatio=2`, Old:Young = 2:1) | 안쪽 큰 보관 선반 |

이 비율은 Serial과 Parallel GC 기준입니다. JDK 9부터 기본인 G1은 Heap을 같은 크기의 Region(이 맥에서는 4MB)으로 잘게 나누고, 각 Region에 Eden, Survivor, Old 역할을 붙입니다. 구역의 모양은 달라도 아래의 나이 먹기와 승격 원리는 같습니다.

## Minor GC: Young만 빠르게 청소

Eden이 가득 차면 Minor GC가 일어납니다.

1. 잠깐 모든 애플리케이션 스레드가 멈춥니다(Stop-the-World). Young만 보기 때문에 멈춤이 짧습니다.
2. GC Root(스택의 지역 변수, static 필드 등)에서 닿는 객체를 찾습니다. Old에서 Young을 가리키는 참조도 Root로 칩니다. Old 전체를 뒤지지 않도록 **카드 테이블**에 "Old의 이 구간이 Young을 가리킨다"는 표시를 해 둡니다.
3. **Eden과 지금 쓰는 Survivor(from)**에서 살아 있는 객체만 **비어 있는 Survivor(to)**로 복사하고, 나이(age)를 1 올립니다.
4. Eden과 from Survivor는 통째로 비웁니다. 죽은 객체를 하나씩 지우는 게 아니라 산 것만 옮기고 나머지는 한 번에 버리기 때문에 빠릅니다.
5. from과 to의 역할이 바뀝니다. 다음 Minor GC에서는 반대 방향으로 복사합니다.

주방 비유: 배식대가 꽉 차면 요리사들이 잠깐 손을 멈춥니다. 정리 담당은 아직 주문서와 끈으로 이어진 접시만 빈 임시 선반으로 옮기면서 스티커를 하나씩 붙이고, 배식대와 원래 선반은 한 번에 싹 닦습니다.

## Old로 올라가는 세 가지 길 (승격, Promotion)

1. **나이가 임계값에 닿으면:** 기본 임계값은 15입니다(`MaxTenuringThreshold=15`). 나이가 15가 된 객체는 다음 Minor GC에서 Old로 옮겨집니다.
2. **동적 나이 판정:** 같은 나이 이하 객체를 모은 크기가 Survivor 공간의 절반(`TargetSurvivorRatio=50`)을 넘으면, JVM이 임계값을 그 나이로 낮춥니다. 그래서 15살이 안 됐어도 일찍 Old로 갈 수 있습니다.
3. **Survivor가 넘치면:** to Survivor에 다 들어가지 않으면 남은 객체는 바로 Old로 갑니다(조기 승격). 원래 금방 죽을 객체가 Old에 쌓이면 Full GC가 잦아지는 원인이 됩니다.

## Full GC: 주방 전체 대청소

Old가 가득 차면 Heap 전체를 청소합니다(mark-sweep-compact 계열). 살아 있는 객체를 표시하고, 죽은 것을 치우고, 빈틈 없이 한쪽으로 모읍니다. 보는 범위가 넓어서 **멈춤이 Minor GC보다 훨씬 깁니다**. 응답 시간이 튀는 서비스라면 먼저 Full GC 로그를 봅니다.

주방 비유: 안쪽 선반까지 꽉 차면 영업을 멈추고 주방 전체를 대청소합니다. 남길 냄비는 한쪽으로 바짝 붙여 정리합니다.

## 직접 확인: 나이가 올라가고 Old로 넘어가는 로그

[`gc-age-demo/AgeDemo.java`](gc-age-demo/AgeDemo.java)는 64KB짜리 곧 버릴 객체를 계속 만들면서, 40번에 한 번 8KB 객체를 리스트에 붙잡아 둡니다. 나이가 보이도록 Serial GC에 Young을 작게(8MB) 잡고 GC 로그를 켰습니다.

```sh
java -XX:+UseSerialGC -Xmn8m -Xmx64m -Xlog:gc,gc+age=trace,gc+heap=debug:file=gc.log AgeDemo.java
```

JDK 21.0.13에서 Minor GC가 42번 일어났고, 로그에서 본 것은 이렇습니다.

**1. 구역 크기가 8:1:1입니다.** Eden 6656K, from 768K, to 768K입니다. GC마다 from과 to의 주소가 서로 바뀝니다.

```
GC(0)   from space 768K,   0% used [0x...fc680000, ...)
GC(0)   to   space 768K,   0% used [0x...fc740000, ...)
(GC 후)
GC(0)   from space 768K, 100% used [0x...fc740000, ...)   ← 직전의 to가 from이 됨
GC(0)   to   space 768K,   0% used [0x...fc680000, ...)
```

**2. 처음에는 동적 나이 판정으로 임계값이 1까지 내려갑니다.** 살아남은 객체(786KB)가 Survivor 절반(393KB)을 넘었기 때문입니다. 그래서 나이 1짜리가 바로 Old로 넘어가 Tenured가 1056K에서 2538K로 늘었습니다.

```
GC(0) Desired survivor size 393216 bytes, new threshold 1 (max threshold 15)
GC(0) - age   1:     786432 bytes,     786432 total
GC(0) Tenured: 1056K(57344K)->2538K(57344K)
```

**3. 살아남는 양이 줄자 임계값이 15로 돌아가고, 나이가 한 칸씩 올라갑니다.**

```
GC(5) - age   1:      24624 bytes
GC(5) - age   2:      24624 bytes
GC(6) - age   3:      24624 bytes
...
GC(18) - age  15:      24624 bytes
```

**4. 나이 15가 된 객체는 다음 GC에서 Old로 갑니다.** GC(18)에서 나이 15였던 24,624바이트가 GC(19)에서 Old로 옮겨져 Tenured가 24K 늘었습니다.

```
GC(18) Tenured: 6299K(57344K)->6299K(57344K)
GC(19) Tenured: 6299K(57344K)->6323K(57344K)
```

Minor GC 한 번의 멈춤은 0.07~2.2ms였습니다. Young이 작고 살아 있는 객체가 적어서 이렇게 짧습니다.
