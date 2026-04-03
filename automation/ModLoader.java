import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class ModLoader {

    private static final String MODS_URL = "https://repoe-fork.github.io/mods.min.json";
    private static final String NOTABLE_PREFIX = "1 Added Passive Skill is ";
    private static final String AFFLICTION_DOMAIN = "affliction_jewel";

    public record SpawnTag(String tag, int weight) {}

    public record SizeEligibility(boolean large, boolean medium, boolean small) {
        public List<String> asList() {
            List<String> out = new ArrayList<>();
            if (large)  out.add("Large");
            if (medium) out.add("Medium");
            if (small)  out.add("Small");
            return out;
        }
    }

    public record AfflictionNotable(
            String key,
            String notableName,
            List<com.hawolt.ModLoader.SpawnTag> spawnTags,
            com.hawolt.ModLoader.SizeEligibility sizes,
            List<String> implicitTags,
            int requiredLevel,
            String generationType
    ) {}

    public static Map<String, com.hawolt.ModLoader.AfflictionNotable> parse() throws IOException, JSONException {
        HttpURLConnection conn = (HttpURLConnection) new URL(MODS_URL).openConnection();
        conn.setRequestProperty("Accept-Encoding", "identity");
        conn.connect();

        String content;
        try (InputStream in = conn.getInputStream()) {
            content = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } finally {
            conn.disconnect();
        }

        if (content.startsWith("\uFEFF")) content = content.substring(1);

        JSONObject root = new JSONObject(content);
        Map<String, com.hawolt.ModLoader.AfflictionNotable> result = new LinkedHashMap<>();

        Iterator<String> keys = root.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            JSONObject entry = root.getJSONObject(key);

            if (!AFFLICTION_DOMAIN.equals(entry.optString("domain"))) continue;

            String text = entry.optString("text", "");
            if (!text.startsWith(NOTABLE_PREFIX)) continue;

            String notableName = text.substring(NOTABLE_PREFIX.length());

            List<com.hawolt.ModLoader.SpawnTag> spawnTags = new ArrayList<>();
            JSONArray sw = entry.optJSONArray("spawn_weights");
            if (sw != null) {
                for (int i = 0; i < sw.length(); i++) {
                    JSONObject w = sw.getJSONObject(i);
                    String tag = w.getString("tag");
                    int weight = w.getInt("weight");
                    if (weight > 0 && !tag.equals("default")) {
                        spawnTags.add(new com.hawolt.ModLoader.SpawnTag(tag, weight));
                    }
                }
            }

            boolean large = false, medium = false, small = false;
            JSONArray gw = entry.optJSONArray("generation_weights");
            if (gw != null) {
                for (int i = 0; i < gw.length(); i++) {
                    JSONObject w = gw.getJSONObject(i);
                    String tag = w.getString("tag");
                    int weight = w.getInt("weight");
                    if (weight > 0) {
                        switch (tag) {
                            case "expansion_jewel_large"  -> large  = true;
                            case "expansion_jewel_medium" -> medium = true;
                            case "expansion_jewel_small"  -> small  = true;
                        }
                    }
                }
            }

            List<String> implicitTags = new ArrayList<>();
            JSONArray it = entry.optJSONArray("implicit_tags");
            if (it != null) {
                for (int i = 0; i < it.length(); i++) implicitTags.add(it.getString(i));
            }

            result.put(key, new com.hawolt.ModLoader.AfflictionNotable(
                    key, notableName, spawnTags,
                    new com.hawolt.ModLoader.SizeEligibility(large, medium, small),
                    implicitTags,
                    entry.optInt("required_level", 0),
                    entry.optString("generation_type", "unknown")
            ));
        }

        return Collections.unmodifiableMap(result);
    }

    public static Map<String, com.hawolt.ModLoader.AfflictionNotable> byNotableName(Map<String, com.hawolt.ModLoader.AfflictionNotable> notables) {
        Map<String, com.hawolt.ModLoader.AfflictionNotable> map = new LinkedHashMap<>();
        notables.values().forEach(n -> map.put(n.notableName(), n));
        return Collections.unmodifiableMap(map);
    }
}