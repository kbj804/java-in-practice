import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// 캐리어 수를 바꿔 가며 같은 작업 세 가지를 돌린다.
// java CarrierDemo.java                                                       → 캐리어 = 코어 수(기본)
// java -Djdk.virtualThreadScheduler.parallelism=200 \
//      -Djdk.virtualThreadScheduler.maxPoolSize=256 CarrierDemo.java          → 캐리어 200개
public class CarrierDemo {
    static volatile long sink;

    static long run(int tasks, Runnable task) {
        long start = System.nanoTime();
        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int i = 0; i < tasks; i++) pool.submit(task);
        }
        return (System.nanoTime() - start) / 1_000_000;
    }

    static void sleep100() {
        try {
            Thread.sleep(100);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    public static void main(String[] args) {
        Runnable io = CarrierDemo::sleep100;                 // I/O 대기 흉내: unmount 한다
        Runnable pinned = () -> {                            // synchronized 안에서 대기: 캐리어를 붙잡는다
            Object lock = new Object();
            synchronized (lock) { sleep100(); }
        };
        Runnable cpu = () -> {                               // CPU 계산만 한다
            long x = 0;
            for (long i = 0; i < 200_000_000L; i++) x += i ^ (x >>> 3);
            sink = x;
        };
        run(20, cpu); // JIT 워밍업
        String carriers = System.getProperty("jdk.virtualThreadScheduler.parallelism",
                Runtime.getRuntime().availableProcessors() + " (default)");
        System.out.printf("carriers %s: io 1000x100ms %d ms, pinned 1000x100ms %d ms, cpu 40 tasks %d ms%n",
                carriers, run(1000, io), run(1000, pinned), run(40, cpu));
    }
}
