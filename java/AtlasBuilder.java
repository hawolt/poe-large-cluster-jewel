import org.json.JSONException;
import org.json.JSONObject;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
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
    private static final Path OUT_ATLAS = Path.of("frontend/public/atlas.webp");
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
        boolean wroteWebp = writeWebp(atlas, OUT_ATLAS);
        if (!wroteWebp) {
            Path pngOut = Path.of(OUT_ATLAS.toString().replaceAll("\\.webp$", ".png"));
            ImageIO.write(atlas, "png", pngOut.toFile());
            System.out.printf("[atlas] WebP writer not available - saved PNG: %s%n", pngOut);
        } else {
            System.out.printf("[atlas] Atlas saved -> %s  (%dx%d)%n", OUT_ATLAS, atlasW, atlasH);
        }
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
                    try { Thread.sleep(2000); } catch (InterruptedException ignored) {}
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

    private static boolean writeWebp(BufferedImage img, Path out) {
        try {
            Iterator<javax.imageio.ImageWriter> writers =
                    ImageIO.getImageWritersByMIMEType("image/webp");
            if (!writers.hasNext()) return false;
            javax.imageio.ImageWriter writer = writers.next();
            javax.imageio.ImageWriteParam param = writer.getDefaultWriteParam();
            try {
                param.setCompressionMode(javax.imageio.ImageWriteParam.MODE_EXPLICIT);
                param.setCompressionQuality(0.90f);
            } catch (Exception ignored) {}
            try (javax.imageio.stream.ImageOutputStream ios =
                         ImageIO.createImageOutputStream(out.toFile())) {
                writer.setOutput(ios);
                writer.write(null, new javax.imageio.IIOImage(img, null, null), param);
            }
            writer.dispose();
            return true;
        } catch (Exception e) {
            System.err.println("[atlas] WebP write error: " + e.getMessage());
            return false;
        }
    }
}