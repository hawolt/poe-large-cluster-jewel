import com.googlecode.pngtastic.core.PngImage;
import com.googlecode.pngtastic.core.PngOptimizer;
import org.json.JSONException;
import org.json.JSONObject;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.List;

public class AtlasBuilder {
    private static final String IMAGE_BASE = "https://image.ggpk.exposed/poe1/";
    private static final Path DATA_DIR = Path.of("frontend/public/data");
    private static final Path OUT_ATLAS = Path.of("frontend/public/media/atlas.png");
    private static final int SPRITE_SIZE = 64;
    private static final int PADDING = 1;
    private static final String[] JSON_FILES = {
            "large_cluster_types.json",
            "medium_cluster_types.json",
            "small_cluster_types.json"
    };

    public static void run() throws IOException, JSONException {
        System.out.println("[atlas] Loading JSON files...");
        Map<String, JSONObject> datasets = new LinkedHashMap<>();
        for (String fname : JSON_FILES) {
            String text = Files.readString(DATA_DIR.resolve(fname));
            datasets.put(fname, new JSONObject(text));
        }
        List<String> iconPaths = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (JSONObject data : datasets.values()) {
            for (String clusterKey : data.keySet()) {
                String icon = data.getJSONObject(clusterKey).optString("icon", null);
                if (icon != null && seen.add(icon)) iconPaths.add(icon);
            }
        }
        System.out.printf("[atlas] %d unique icons found.%n", iconPaths.size());
        Map<String, BufferedImage> sprites = new LinkedHashMap<>();
        int i = 0;
        for (String icon : iconPaths) {
            i++;
            String url = IMAGE_BASE + icon.replaceAll("\\.png$", "") + ".dds";
            System.out.printf("[atlas] [%d/%d] %s%n", i, iconPaths.size(), url);
            byte[] raw = download(url);
            BufferedImage img;
            if (raw == null) {
                img = placeholder();
            } else {
                try {
                    img = ImageIO.read(new ByteArrayInputStream(raw));
                    if (img == null) throw new IOException("ImageIO could not decode response");
                } catch (Exception e) {
                    System.err.printf("[atlas]   decode failed (%s) - using placeholder%n", e.getMessage());
                    img = placeholder();
                }
            }
            sprites.put(icon, resize(img, SPRITE_SIZE, SPRITE_SIZE));
        }
        System.out.println("[atlas] Packing atlas...");
        int count = iconPaths.size();
        int cols = (int) Math.ceil(Math.sqrt(count));
        int rows = (int) Math.ceil((double) count / cols);
        int step = SPRITE_SIZE + PADDING;
        int rawW = cols * step + PADDING;
        int rawH = rows * step + PADDING;
        int atlasW = nextPow2(rawW);
        int atlasH = nextPow2(rawH);
        BufferedImage atlas = new BufferedImage(atlasW, atlasH, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = atlas.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        Map<String, int[]> coords = new LinkedHashMap<>();
        for (int idx = 0; idx < iconPaths.size(); idx++) {
            int col = idx % cols;
            int row = idx / cols;
            int x = PADDING + col * step;
            int y = PADDING + row * step;
            g.drawImage(sprites.get(iconPaths.get(idx)), x, y, null);
            coords.put(iconPaths.get(idx), new int[]{x, y});
        }
        g.dispose();
        OUT_ATLAS.getParent().toFile().mkdirs();
        BufferedImage quantized = quantize(atlas, 256);
        writePng(quantized, OUT_ATLAS);
        long size = Files.size(OUT_ATLAS);
        System.out.printf("[atlas] Atlas saved -> %s  (%dx%d, %d bytes)%n", OUT_ATLAS, atlasW, atlasH, size);
        System.out.println("[atlas] Rewriting JSON files...");
        for (Map.Entry<String, JSONObject> entry : datasets.entrySet()) {
            JSONObject data = entry.getValue();
            for (String clusterKey : data.keySet()) {
                JSONObject cluster = data.getJSONObject(clusterKey);
                String icon = cluster.optString("icon", null);
                if (icon == null) continue;
                cluster.remove("icon");
                int[] xy = coords.get(icon);
                if (xy != null) {
                    JSONObject atlasCoord = new JSONObject();
                    atlasCoord.put("x", xy[0]);
                    atlasCoord.put("y", xy[1]);
                    atlasCoord.put("w", SPRITE_SIZE);
                    atlasCoord.put("h", SPRITE_SIZE);
                    cluster.put("atlas", atlasCoord);
                }
            }
            Path outPath = DATA_DIR.resolve(entry.getKey());
            Files.writeString(outPath, data.toString(), StandardCharsets.UTF_8);
            System.out.printf("[atlas]   wrote %s%n", outPath);
        }
        System.out.println("[atlas] Done.");
    }

    // -------------------------------------------------------------------------
    // Median-cut RGBA quantizer — reduces to maxColors palette entries
    // preserving alpha. Produces an IndexColorModel PNG.
    // -------------------------------------------------------------------------
    private static BufferedImage quantize(BufferedImage src, int maxColors) {
        int w = src.getWidth();
        int h = src.getHeight();
        int[] pixels = src.getRGB(0, 0, w, h, null, 0, w);

        // Collect all unique RGBA values
        List<int[]> cubes = new ArrayList<>();
        cubes.add(pixels.clone());

        // Median-cut: split the largest cube along its widest channel until we have maxColors cubes
        while (cubes.size() < maxColors) {
            // Find cube with most pixels (largest volume by range)
            int splitIdx = 0;
            int maxRange = 0;
            for (int ci = 0; ci < cubes.size(); ci++) {
                int range = cubeRange(cubes.get(ci));
                if (range > maxRange) {
                    maxRange = range;
                    splitIdx = ci;
                }
            }
            if (maxRange == 0) break;
            int[] cube = cubes.remove(splitIdx);
            int[][] halves = splitCube(cube);
            cubes.add(halves[0]);
            cubes.add(halves[1]);
        }

        // Build palette: average color in each cube
        int paletteSize = cubes.size();
        byte[] reds = new byte[paletteSize];
        byte[] greens = new byte[paletteSize];
        byte[] blues = new byte[paletteSize];
        byte[] alphas = new byte[paletteSize];
        for (int ci = 0; ci < paletteSize; ci++) {
            long r = 0, g = 0, b = 0, a = 0;
            for (int px : cubes.get(ci)) {
                a += (px >> 24) & 0xFF;
                r += (px >> 16) & 0xFF;
                g += (px >> 8) & 0xFF;
                b += px & 0xFF;
            }
            int n = cubes.get(ci).length;
            reds[ci] = (byte) (r / n);
            greens[ci] = (byte) (g / n);
            blues[ci] = (byte) (b / n);
            alphas[ci] = (byte) (a / n);
        }

        IndexColorModel icm = new IndexColorModel(8, paletteSize, reds, greens, blues, alphas);
        BufferedImage indexed = new BufferedImage(w, h, BufferedImage.TYPE_BYTE_INDEXED, icm);

        // Map each pixel to nearest palette entry
        WritableRaster raster = indexed.getRaster();
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                raster.setSample(x, y, 0, nearestPalette(pixels[y * w + x], reds, greens, blues, alphas, paletteSize));
            }
        }
        return indexed;
    }

    private static int cubeRange(int[] cube) {
        int minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0, minA = 255, maxA = 0;
        for (int px : cube) {
            int a = (px >> 24) & 0xFF, r = (px >> 16) & 0xFF, g = (px >> 8) & 0xFF, b = px & 0xFF;
            if (r < minR) minR = r;
            if (r > maxR) maxR = r;
            if (g < minG) minG = g;
            if (g > maxG) maxG = g;
            if (b < minB) minB = b;
            if (b > maxB) maxB = b;
            if (a < minA) minA = a;
            if (a > maxA) maxA = a;
        }
        return Math.max(Math.max(maxR - minR, maxG - minG), Math.max(maxB - minB, maxA - minA));
    }

    private static int[][] splitCube(int[] cube) {
        // Find widest channel
        int minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0, minA = 255, maxA = 0;
        for (int px : cube) {
            int a = (px >> 24) & 0xFF, r = (px >> 16) & 0xFF, g = (px >> 8) & 0xFF, b = px & 0xFF;
            if (r < minR) minR = r;
            if (r > maxR) maxR = r;
            if (g < minG) minG = g;
            if (g > maxG) maxG = g;
            if (b < minB) minB = b;
            if (b > maxB) maxB = b;
            if (a < minA) minA = a;
            if (a > maxA) maxA = a;
        }
        int rRange = maxR - minR, gRange = maxG - minG, bRange = maxB - minB, aRange = maxA - minA;
        int maxRange = Math.max(Math.max(rRange, gRange), Math.max(bRange, aRange));

        final int channel;
        if (maxRange == rRange) channel = 0;
        else if (maxRange == gRange) channel = 1;
        else if (maxRange == bRange) channel = 2;
        else channel = 3;

        // Sort by that channel and split at median
        Integer[] boxed = new Integer[cube.length];
        for (int i = 0; i < cube.length; i++) boxed[i] = cube[i];
        Arrays.sort(boxed, (a, b) -> {
            int ca = switch (channel) {
                case 0 -> (a >> 16) & 0xFF;
                case 1 -> (a >> 8) & 0xFF;
                case 2 -> a & 0xFF;
                default -> (a >> 24) & 0xFF;
            };
            int cb = switch (channel) {
                case 0 -> (b >> 16) & 0xFF;
                case 1 -> (b >> 8) & 0xFF;
                case 2 -> b & 0xFF;
                default -> (b >> 24) & 0xFF;
            };
            return Integer.compare(ca, cb);
        });
        int mid = boxed.length / 2;
        int[] half1 = new int[mid];
        int[] half2 = new int[boxed.length - mid];
        for (int i = 0; i < mid; i++) half1[i] = boxed[i];
        for (int i = mid; i < boxed.length; i++) half2[i - mid] = boxed[i];
        return new int[][]{half1, half2};
    }

    private static int nearestPalette(int px, byte[] r, byte[] g, byte[] b, byte[] a, int size) {
        int pa = (px >> 24) & 0xFF, pr = (px >> 16) & 0xFF, pg = (px >> 8) & 0xFF, pb = px & 0xFF;
        int best = 0, bestDist = Integer.MAX_VALUE;
        for (int i = 0; i < size; i++) {
            int da = pa - (a[i] & 0xFF), dr = pr - (r[i] & 0xFF), dg = pg - (g[i] & 0xFF), db = pb - (b[i] & 0xFF);
            int dist = da * da + dr * dr + dg * dg + db * db;
            if (dist < bestDist) {
                bestDist = dist;
                best = i;
            }
        }
        return best;
    }

    private static void writePng(BufferedImage img, Path out) throws IOException {
        long before = img.getWidth() * img.getHeight() * 4L;
        PngImage image = new PngImage(toInputStream(img));
        PngOptimizer optimizer = new PngOptimizer();
        PngImage optimized = optimizer.optimize(image, false, 9);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        optimized.writeDataOutputStream(baos);
        optimized.export(out.toString(), baos.toByteArray());
        System.out.printf("[atlas] Compressed: %d raw -> %d bytes%n", before, Files.size(out));
    }

    private static InputStream toInputStream(BufferedImage img) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ImageIO.write(img, "png", baos);
        return new ByteArrayInputStream(baos.toByteArray());
    }

    private static byte[] download(String urlStr) {
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
                conn.setRequestProperty("User-Agent", "cluster-jewel-atlas/1.0");
                conn.setConnectTimeout(15_000);
                conn.setReadTimeout(30_000);
                conn.connect();
                int code = conn.getResponseCode();
                if (code != 200) {
                    System.err.printf("[atlas]   HTTP %d for %s%n", code, urlStr);
                    return null;
                }
                try (InputStream in = conn.getInputStream()) {
                    return in.readAllBytes();
                } finally {
                    conn.disconnect();
                }
            } catch (Exception e) {
                if (attempt < 2) {
                    try {
                        Thread.sleep(2000);
                    } catch (InterruptedException ignored) {
                    }
                } else {
                    System.err.printf("[atlas]   FAILED %s: %s%n", urlStr, e.getMessage());
                }
            }
        }
        return null;
    }

    private static int nextPow2(int n) {
        int p = 1;
        while (p < n) p <<= 1;
        return p;
    }

    private static BufferedImage placeholder() {
        BufferedImage img = new BufferedImage(SPRITE_SIZE, SPRITE_SIZE, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setColor(new Color(40, 40, 40, 180));
        g.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
        g.dispose();
        return img;
    }

    private static BufferedImage resize(BufferedImage src, int w, int h) {
        if (src.getWidth() == w && src.getHeight() == h) return src;
        BufferedImage dst = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = dst.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g.drawImage(src, 0, 0, w, h, null);
        g.dispose();
        return dst;
    }
}