import java.lang.management.ManagementFactory;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// 작업 10,000개가 각각 1초씩 기다린다(I/O 대기 흉내).
// java SleepDemo.java platform   → 플랫폼 스레드 200개 고정 풀
// java SleepDemo.java per-task   → 작업마다 플랫폼 스레드 하나(10,000개)
// java SleepDemo.java virtual    → 작업마다 가상 스레드 하나
public class SleepDemo {
    static final int TASKS = 10_000;

    public static void main(String[] args) throws Exception {
        String mode = args.length > 0 ? args[0] : "virtual";
        long start = System.nanoTime();
        int started = 0;
        try (ExecutorService pool = switch (mode) {
            case "platform" -> Executors.newFixedThreadPool(200);
            case "per-task" -> Executors.newThreadPerTaskExecutor(Thread.ofPlatform().factory());
            default -> Executors.newVirtualThreadPerTaskExecutor();
        }) {
            for (int i = 0; i < TASKS; i++) {
                try {
                    pool.submit(() -> {
                        Thread.sleep(1_000);
                        return null;
                    });
                    started++;
                } catch (OutOfMemoryError e) { // OS 가 스레드를 더 만들어 주지 않는다
                    System.out.printf("%s: failed at task %d: %s%n", mode, i, e.getMessage());
                    break;
                }
            }
        } // close() 가 모든 작업이 끝날 때까지 기다린다
        long ms = (System.nanoTime() - start) / 1_000_000;
        int peak = ManagementFactory.getThreadMXBean().getPeakThreadCount();
        System.out.printf("%s: %d/%d tasks, %d ms, peak platform threads %d%n", mode, started, TASKS, ms, peak);
    }
}
