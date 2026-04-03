import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public class Exporter {

    private static final String SKILLTREE_URL =
            "https://raw.githubusercontent.com/grindinggear/skilltree-export/refs/heads/master/data.json";

    public static void main(String[] args) throws IOException, JSONException {
        ClusterParser.ClusterJewelData jewels =
                ClusterParser.parseFile(Path.of("ClusterJewels.lua"));

        Map<String, ModLoader.AfflictionNotable> modsByName =
                ModLoader.byNotableName(ModLoader.parse());

        Map<String, ClusterParser.NotableInfo> infoByName = new LinkedHashMap<>();
        for (ClusterParser.NotableInfo ni : jewels.notableIndex()) {
            infoByName.put(ni.name(), ni);
        }

        // Fetch skilltree data.json and build id -> stats[] lookup
        Map<String, List<String>> statsBySkillId = fetchSkillTreeStats();

        // Build tag -> skill maps for each jewel size
        Map<String, ClusterParser.SkillEntry> skillByTagSmall = new LinkedHashMap<>();
        Map<String, ClusterParser.SkillEntry> skillByTagMedium = new LinkedHashMap<>();
        Map<String, ClusterParser.SkillEntry> skillByTagLarge = new LinkedHashMap<>();

        ClusterParser.JewelDef smallDef = jewels.jewels().get("Small Cluster Jewel");
        if (smallDef != null)
            for (ClusterParser.SkillEntry skill : smallDef.skills().values())
                skillByTagSmall.put(skill.tag(), skill);

        ClusterParser.JewelDef mediumDef = jewels.jewels().get("Medium Cluster Jewel");
        if (mediumDef != null)
            for (ClusterParser.SkillEntry skill : mediumDef.skills().values())
                skillByTagMedium.put(skill.tag(), skill);

        ClusterParser.JewelDef largeDef = jewels.jewels().get("Large Cluster Jewel");
        if (largeDef != null)
            for (ClusterParser.SkillEntry skill : largeDef.skills().values())
                skillByTagLarge.put(skill.tag(), skill);

        write(Path.of("large_cluster_types.json"),
                buildClusterTypes(jewels, modsByName, infoByName, skillByTagLarge, statsBySkillId));
        write(Path.of("medium_cluster_types.json"),
                buildClusterTypes(jewels, modsByName, infoByName, skillByTagMedium, statsBySkillId));
        write(Path.of("small_cluster_types.json"),
                buildClusterTypes(jewels, modsByName, infoByName, skillByTagSmall, statsBySkillId));
    }

    // -------------------------------------------------------------------------
    // Fetch https://raw.githubusercontent.com/…/data.json
    // Returns Map<skillId, List<statString>>
    // -------------------------------------------------------------------------
    private static Map<String, List<String>> fetchSkillTreeStats() throws IOException, JSONException {
        HttpURLConnection conn = (HttpURLConnection) new URL(SKILLTREE_URL).openConnection();
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

        JSONObject nodes;
        if (root.has("nodes")) {
            nodes = root.getJSONObject("nodes");
        } else {
            nodes = root;
        }

        Map<String, List<String>> result = new LinkedHashMap<>();
        Iterator<String> keys = nodes.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Object val = nodes.get(key);
            if (!(val instanceof JSONObject entry)) continue;

            // Only notables are relevant
            if (!entry.optBoolean("isNotable", false)) continue;

            String name = entry.getString("name");

            JSONArray statsArr = entry.optJSONArray("stats");
            List<String> stats = new ArrayList<>();
            if (statsArr != null) {
                for (int i = 0; i < statsArr.length(); i++) stats.add(statsArr.getString(i));
            }
            result.put(name, stats);
        }
        return result;
    }

    // -------------------------------------------------------------------------
    // Build one cluster-types JSON (large / medium / small)
    // -------------------------------------------------------------------------
    private static JSONObject buildClusterTypes(
            ClusterParser.ClusterJewelData jewels,
            Map<String, ModLoader.AfflictionNotable> modsByName,
            Map<String, ClusterParser.NotableInfo> infoByName,
            Map<String, ClusterParser.SkillEntry> skillByTag,
            Map<String, List<String>> statsBySkillId) throws JSONException {

        Set<String> clusterTags = skillByTag.keySet();

        Map<String, List<JSONObject>> prefixByTag = new LinkedHashMap<>();
        Map<String, List<JSONObject>> suffixByTag = new LinkedHashMap<>();
        for (String tag : clusterTags) {
            prefixByTag.put(tag, new ArrayList<>());
            suffixByTag.put(tag, new ArrayList<>());
        }

        for (ModLoader.AfflictionNotable mod : modsByName.values()) {
            for (ModLoader.SpawnTag st : mod.spawnTags()) {
                if (!clusterTags.contains(st.tag())) continue;

                int sortId = jewels.notableSortOrder().getOrDefault(mod.notableName(), -1);

                JSONObject entry = new JSONObject();
                entry.put("id", sortId);
                entry.put("name", mod.notableName());

                // Inject stats from skilltree data.json if available
                JSONArray statsArr = new JSONArray();
                List<String> stats = statsBySkillId.get(mod.notableName());
                if (stats != null) for (String s : stats) statsArr.put(s);
                entry.put("stats", statsArr);

                ("prefix".equals(mod.generationType()) ? prefixByTag : suffixByTag)
                        .get(st.tag()).add(entry);
            }
        }

        Comparator<JSONObject> byId = Comparator.comparingInt(n -> {
            try {
                return n.getInt("id");
            } catch (JSONException ex) {
                return Integer.MAX_VALUE;
            }
        });

        JSONObject root = new JSONObject();
        for (String tag : clusterTags) {
            List<JSONObject> prefixes = prefixByTag.get(tag);
            List<JSONObject> suffixes = suffixByTag.get(tag);
            if (prefixes.isEmpty() && suffixes.isEmpty()) continue;

            prefixes.sort(byId);
            suffixes.sort(byId);

            JSONArray prefixArr = new JSONArray();
            for (JSONObject n : prefixes) prefixArr.put(n);
            JSONArray suffixArr = new JSONArray();
            for (JSONObject n : suffixes) suffixArr.put(n);

            ClusterParser.SkillEntry skillEntry = skillByTag.get(tag);
            JSONArray smallStats = new JSONArray();
            if (skillEntry != null) for (String s : skillEntry.stats()) smallStats.put(s);

            JSONObject typeObj = new JSONObject();
            typeObj.put("small_passive_stats", smallStats);
            if (skillEntry != null) typeObj.put("icon", skillEntry.icon());
            typeObj.put("prefix_notables", prefixArr);
            typeObj.put("suffix_notables", suffixArr);
            root.put(tag, typeObj);
        }

        return root;
    }

    private static void write(Path path, JSONObject obj) throws IOException, JSONException {
        Files.writeString(path, obj.toString(2), StandardCharsets.UTF_8);
    }
}