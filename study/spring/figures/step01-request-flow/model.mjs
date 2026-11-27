// 1단계 그림의 모델: POST /posts 요청 한 건이 거치는 단계.
// at = 요청(토큰)이 있는 상자, thread/conn = 그 단계에서 Tomcat 스레드 T1·커넥션 C1 을 쥐고 있는지,
// sql = 그 단계에서 커넥션으로 DB 에 보내는 것.
// 커넥션은 트랜잭션이 시작될 때 빌리고 커밋할 때 돌려준다(JpaTransactionManager, open-in-view: false).
export const STAGES = [
  {
    at: "tomcat", title: "요청 도착", thread: true, conn: false,
    spring: "Tomcat이 스레드 풀에서 T1을 꺼내 이 요청을 맡깁니다. 응답을 보낼 때까지 T1은 이 요청만 처리합니다.",
    fastapi: "uvicorn 워커의 이벤트 루프가 받습니다. 요청마다 스레드를 따로 주지 않습니다.",
    code: 'POST /posts\n{"authorId": 1, "regionId": 100, "content": "붕어빵 어디서 팔아요?"}',
  },
  {
    at: "dispatch", title: "컨트롤러 찾기", thread: true, conn: false,
    spring: "DispatcherServlet이 URL과 HTTP 메서드로 @PostMapping이 붙은 메서드를 찾습니다.",
    fastapi: "APIRouter가 경로로 핸들러 함수를 찾는 것과 같습니다.",
    code: '@RestController\n@RequestMapping("/posts")\nclass PostController(...) {\n    @PostMapping fun create(...)',
  },
  {
    at: "ctrl", title: "JSON 읽기와 검증", thread: true, conn: false,
    spring: "JSON 본문을 CreatePostRequest로 바꾸고(Jackson) @Valid로 검증합니다. 검증에 실패하면 여기서 바로 400을 돌려줍니다.",
    fastapi: "요청 본문을 Pydantic 모델로 파싱하고 검증하는 단계입니다.",
    code: "fun create(@Valid @RequestBody request: CreatePostRequest)\n\ndata class CreatePostRequest(\n    @field:NotBlank @field:Size(max = 2000) val content: String, ...)",
  },
  {
    at: "proxy", title: "트랜잭션 시작", thread: true, conn: true,
    spring: "PostService.create 호출을 Spring이 끼워 둔 프록시가 먼저 받습니다. 프록시가 트랜잭션을 열면서 HikariCP에서 커넥션 C1을 빌립니다.",
    fastapi: "async with session.begin(): 에 들어가는 순간입니다.",
    code: "@Transactional            // ← 프록시가 여기서 트랜잭션 시작\nfun create(authorId: Long, regionId: Long, content: String): Post",
  },
  {
    at: "svc", title: "서비스 로직", thread: true, conn: true,
    spring: "PostService 본문이 실행됩니다. 현재 시각은 직접 부르지 않고 주입받은 Clock에서 가져와 Post 객체를 만듭니다.",
    fastapi: "서비스 함수 본문입니다. 테스트에서 freezegun 대신 Clock을 바꿔 끼웁니다.",
    code: "Post(authorId = authorId, regionId = regionId,\n     content = content, createdAt = clock.instant())",
  },
  {
    at: "repo", title: "save 호출", thread: true, conn: true,
    spring: "Spring Data가 만든 PostRepository 구현체가 save를 받습니다. id가 없으니 새 객체로 보고 Hibernate의 persist를 부릅니다.",
    fastapi: "session.add(post) 입니다.",
    code: "postRepository.save(post)\n\n// 구현체(SimpleJpaRepository): id 가 null → em.persist(post)",
  },
  {
    at: "hib", title: "INSERT 실행", thread: true, conn: true, sql: "INSERT",
    spring: "Hibernate가 C1로 INSERT를 보냅니다. id를 DB가 만드는 방식(IDENTITY)이라 커밋을 기다리지 않고 바로 실행해서 id를 받아 옵니다.",
    fastapi: "session.flush()로 INSERT를 먼저 보내고 id를 받는 것과 같습니다.",
    code: "insert into post (author_id, region_id, content, created_at)\nvalues (?, ?, ?, ?) returning id",
  },
  {
    at: "proxy", title: "커밋과 커넥션 반납", thread: true, conn: true, sql: "COMMIT",
    spring: "메서드가 예외 없이 끝나면 프록시가 COMMIT하고 C1을 풀에 돌려줍니다. RuntimeException이 났다면 ROLLBACK합니다.",
    fastapi: "with 블록을 빠져나가며 commit되는 순간입니다.",
    code: "}                          // ← 프록시: COMMIT, 커넥션 C1 반납",
  },
  {
    at: "ctrl", title: "응답", thread: true, conn: false,
    spring: "컨트롤러가 Post를 PostResponse로 바꿔 JSON으로 보내고 201을 돌려줍니다. 그다음 T1이 풀로 돌아갑니다. open-in-view를 켜 두면 이 단계까지 커넥션을 쥡니다.",
    fastapi: "response_model로 직렬화해서 돌려주는 단계입니다.",
    code: 'PostResponse.from(post)    // → 201 Created\n{"id": 1, "authorId": 1, "regionId": 100, ...}',
  },
];

export const STAGE_SECONDS = 1.6;
export const MOVE_SECONDS = 0.45;
