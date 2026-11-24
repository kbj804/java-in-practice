# 01. 게시글 API로 본 Spring Boot 기본기 (FastAPI와 비교)

> 처음 실습은 Kotlin + Spring Boot 4로 했습니다. 표의 파일 이름은 그 실습 기준이고, 이 레포에서는 Java로 다시 옮겨 갈 예정입니다.

## 파일 하나씩 대응시키기

| 이 프로젝트 | FastAPI에서 해온 것 | 다른 점 |
|---|---|---|
| `build.gradle.kts` | `pyproject.toml` + `uv.lock` | 버전은 Spring Boot BOM이 맞춰 준다. 라이브러리마다 버전을 적지 않는 이유 |
| `CommunityApplication.kt` | `app = FastAPI()` + `uvicorn` | `@SpringBootApplication`이 같은 패키지 아래 클래스를 스캔해서 Bean으로 등록한다 |
| `PostController` | `@router.post("/posts")` | `@RequestBody` 데이터 클래스 = Pydantic 모델. 검증은 `@field:NotBlank` 같은 Bean Validation |
| `PostService` + `@Transactional` | `with session.begin():` | 트랜잭션 경계를 코드 블록이 아니라 메서드에 붙인다. Spring이 클래스를 프록시로 감싸서 처리 |
| `PostRepository` (인터페이스만) | SQLAlchemy 쿼리 직접 작성 | 메서드 이름(`findByRegionIdOrderByCreatedAtDesc`)으로 쿼리를 만든다 |
| `Post` 엔티티 | SQLAlchemy 모델 | Hibernate가 객체 변경을 추적해서 커밋 때 UPDATE를 알아서 날린다(dirty checking) |
| Flyway `V1__create_post.sql` | Alembic | 버전 파일 이름 규칙으로 순서를 정한다. `ddl-auto: validate`로 엔티티와 스키마가 맞는지만 확인 |
| 생성자 주입 (`PostService(postRepository, clock)`) | `Depends(get_db)` | 요청마다가 아니라 앱이 뜰 때 한 번 조립된다(싱글턴) |
| `Clock` 주입 + 테스트 고정 Clock | `freezegun` | 시간을 몰래 바꾸지 않고, 의존성으로 받아서 바꾼다. 당근이 CI로 강제하는 규칙 |
| Testcontainers + `@ServiceConnection` | `resume_test` DB에 붙여 pytest | 테스트가 뜰 때 진짜 Postgres 컨테이너를 띄우고 접속 정보를 자동으로 덮어쓴다 |

## 꼭 기억할 것 4가지

1. **Kotlin 클래스는 기본이 `final`이다.** Spring은 `@Transactional`을 프록시(상속)로 구현하고, Hibernate는 지연 로딩 프록시를 만든다. 그래서 `plugin.spring`(all-open)과 `plugin.jpa`(no-arg)가 필요하다. 빠지면 트랜잭션이 조용히 안 걸린다.
2. **`open-in-view`는 기본값이 `true`다.** 켜 두면 컨트롤러가 응답을 다 쓸 때까지 DB 커넥션을 쥐고 있다. [Spring 02](02-connection-pool.md)(풀 고갈)과 직접 관련되므로 꺼 두었다. "OSIV를 왜 끄나요?"는 자주 나오는 질문이다.
3. **같은 클래스 안에서 `@Transactional` 메서드를 부르면 트랜잭션이 안 걸린다.** 프록시를 거치지 않기 때문이다.
4. **`readOnly = true`**는 Hibernate가 변경 추적을 생략하게 해서 조회를 가볍게 한다. 읽기 전용 복제본으로 보내는 라우팅의 근거로도 쓰인다.

## 실제로 본 것

- 앱이 뜨는 데 약 **2초**. `bootRun`은 빠른 시작을 위해 `-XX:TieredStopAtLevel=1`(JIT 최적화를 덜 함)로 띄운다. 운영에서는 이 옵션이 없어서, 막 뜬 Pod이 처음엔 느리다(워밍업, [JVM 01 ④](../jvm/01-how-jvm-works.md)).
- Spring Boot 4에서 바뀐 이름: `spring-boot-starter-web` → `spring-boot-starter-webmvc`, Flyway도 이제 `spring-boot-starter-flyway`가 필요하다. Jackson 3은 패키지가 `tools.jackson`. Testcontainers 2는 `org.testcontainers.postgresql.PostgreSQLContainer`. 인터넷 예제가 대부분 Boot 3 기준이라 그대로 복사하면 안 맞는다.
