import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.locks.ReentrantLock;

// 가상 스레드 100개가 각자 자기 락을 잡고 100ms 기다린다. 락끼리 경쟁은 없다.
// java -Djdk.tracePinnedThreads=short PinningDemo.java sync   → synchronized 안에서 sleep: 캐리어가 붙잡힘(pinning)
// java PinningDemo.java lock                                   → ReentrantLock 안에서 sleep: 캐리어를 내려놓음
public class PinningDemo {
    static final int TASKS = 100;

    public static void main(String[] args) throws Exception {
        String mode = args.length > 0 ? args[0] : "sync";
        long start = System.nanoTime();
        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int i = 0; i < TASKS; i++) {
                Object monitor = new Object();
                ReentrantLock lock = new ReentrantLock();
                pool.submit(() -> {
                    if (mode.equals("sync")) {
                        synchronized (monitor) {
                            Thread.sleep(100);
                        }
                    } else {
                        lock.lock();
                        try {
                            Thread.sleep(100);
                        } finally {
                            lock.unlock();
                        }
                    }
                    return null;
                });
            }
        }
        long ms = (System.nanoTime() - start) / 1_000_000;
        System.out.printf("%s: %d virtual threads x 100 ms, %d ms (carriers %d)%n",
                mode, TASKS, ms, Runtime.getRuntime().availableProcessors());
    }
}
