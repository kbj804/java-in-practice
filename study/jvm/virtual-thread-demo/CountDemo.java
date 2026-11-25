import java.lang.management.ManagementFactory;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;

// 가상 스레드 n개를 만들어 모두 기다리게 세워 두고, 힙이 얼마나 늘었는지 잰다.
// java -Xmx8g CountDemo.java 1000000
// java -Xmx8g CountDemo.java 5000000
public class CountDemo {
    public static void main(String[] args) throws Exception {
        int n = args.length > 0 ? Integer.parseInt(args[0]) : 1_000_000;
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch parked = new CountDownLatch(n);
        List<Thread> threads = new ArrayList<>(n);
        Runtime rt = Runtime.getRuntime();
        System.gc();
        long before = rt.totalMemory() - rt.freeMemory();
        long start = System.nanoTime();
        for (int i = 0; i < n; i++) {
            threads.add(Thread.ofVirtual().start(() -> {
                parked.countDown();
                try {
                    release.await(); // 여기서 unmount 해서 힙에서 기다린다
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }));
        }
        parked.await();
        long ms = (System.nanoTime() - start) / 1_000_000;
        System.gc();
        long used = rt.totalMemory() - rt.freeMemory() - before;
        int platform = ManagementFactory.getThreadMXBean().getThreadCount(); // 가상 스레드는 세지 않는다
        System.out.printf("%,d virtual threads parked: %d ms, heap +%,d MB (%d B each), platform threads %d%n",
                n, ms, used >> 20, used / n, platform);
        release.countDown();
        for (Thread t : threads) t.join();
    }
}
