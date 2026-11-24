import java.util.ArrayList;
import java.util.List;

public class AgeDemo {
    static List<byte[]> keep = new ArrayList<>();

    public static void main(String[] args) {
        for (int i = 0; i < 4000; i++) {
            byte[] garbage = new byte[64 * 1024];      // 곧 버려지는 객체
            if (i % 40 == 0) keep.add(new byte[8 * 1024]); // 오래 살아남는 객체
        }
        System.out.println("kept=" + keep.size());
    }
}
