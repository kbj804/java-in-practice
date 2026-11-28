-- 목록 캐시에 담을 제목과, 신고로 가린 글 표시.
alter table post add column title varchar(100) not null default '';
alter table post add column blinded_at timestamptz; -- null 이 아니면 블라인드. 목록에서 빠진다

-- 동네 최신 글 목록을 다시 만드는 쿼리: 가려지지 않은 글만, 최신(id 큰) 순
create index post_region_visible_idx on post (region_id, id desc) where blinded_at is null;
