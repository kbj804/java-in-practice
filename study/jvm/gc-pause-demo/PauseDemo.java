import java.util.concurrent.ThreadLocalRandom;

// 살아 있는 객체를 많이(약 1GB) 들고 있으면서, 계속 새 객체로 바꿔 끼우는 서버 흉내
public class PauseDemo {
    public static void main(String[] args) {
        int slots = 1_000_000;
        byte[][] cache = new byte[slots][];
        for (int i = 0; i < slots; i++) cache[i] = new byte[1024];

        long end = System.currentTimeMillis() + Long.parseLong(args[0]) * 1000;
        long sink = 0;
        while (System.currentTimeMillis() < end) {
            ThreadLocalRandom r = ThreadLocalRandom.current();
            cache[r.nextInt(slots)] = new byte[1024];     // 캐시 교체: 오래 산 객체가 죽음
            byte[] tmp = new byte[r.nextInt(64, 4096)];   // 요청마다 생기는 임시 객체
            sink += tmp.length;
        }
        System.out.println("done " + sink);
    }
}
