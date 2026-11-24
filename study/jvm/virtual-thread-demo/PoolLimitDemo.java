import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;

// 커넥션 풀 흉내: 허가 10개(Hikari 기본 maximumPoolSize=10).
// 가상 스레드 1,000개가 각각 커넥션을 100ms 잡는다. 동시성이 1,000이어도 처리량 상한은 풀 크기다.
public class PoolLimitDemo {
    static final int TASKS = 1_000;
    static final Semaphore POOL = new Semaphore(10);

    public static void main(String[] args) throws Exception {
        AtomicInteger waitingMax = new AtomicInteger();
        long start = System.nanoTime();
        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int i = 0; i < TASKS; i++) {
                pool.submit(() -> {
                    waitingMax.accumulateAndGet(POOL.getQueueLength(), Math::max);
                    POOL.acquire();
                    try {
                        Thread.sleep(100); // 쿼리 하나
                    } finally {
                        POOL.release();
                    }
                    return null;
                });
            }
        }
        long ms = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("%d virtual threads, pool 10, 100 ms each: %d ms, max waiting %d%n", TASKS, ms, waitingMax.get());
    }
}
