import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public class Exporter {

    public static void main(String[] args) throws IOException, JSONException {
        ClusterParser.ClusterJewelData jewels =
                ClusterParser.parseFile(Path.of("ClusterJewels.lua"));

        Map<String, ModLoader.AfflictionNotable> modsByName =
                ModLoader.byNotableName(ModLoader.parse());

        Map<String, ClusterParser.NotableInfo> infoByName = new LinkedHashMap<>();
        for (ClusterParser.NotableInfo ni : jewels.notableIndex()) {
            infoByName.put(ni.name(), ni);
        }

        Map<String, ClusterParser.SkillEntry> skillByTagSmall = new LinkedHashMap<>();
        ClusterParser.JewelDef smallDef = jewels.jewels().get("Small Cluster Jewel");
        if (smallDef != null) {
            for (ClusterParser.SkillEntry skill : smallDef.skills().values()) {
                skillByTagSmall.put(skill.tag(), skill);
            }
        }

        Map<String, ClusterParser.SkillEntry> skillByTagMedium = new LinkedHashMap<>();
        ClusterParser.JewelDef mediumDef = jewels.jewels().get("Medium Cluster Jewel");
        if (mediumDef != null) {
            for (ClusterParser.SkillEntry skill : mediumDef.skills().values()) {
                skillByTagMedium.put(skill.tag(), skill);
            }
        }

        Map<String, ClusterParser.SkillEntry> skillByTagLarge = new LinkedHashMap<>();
        ClusterParser.JewelDef largeDef = jewels.jewels().get("Large Cluster Jewel");
        if (largeDef != null) {
            for (ClusterParser.SkillEntry skill : largeDef.skills().values()) {
                skillByTagLarge.put(skill.tag(), skill);
            }
        }

        write(Path.of("large_cluster_types.json"), buildLargeClusterTypes(jewels, modsByName, infoByName, skillByTagLarge));
        write(Path.of("medium_cluster_types.json"), buildLargeClusterTypes(jewels, modsByName, infoByName, skillByTagMedium));
        write(Path.of("small_cluster_types.json"), buildLargeClusterTypes(jewels, modsByName, infoByName, skillByTagSmall));

        write(Path.of("notable_ids.json"), buildNotableIds(jewels, modsByName, infoByName));
    }

    private static JSONObject buildLargeClusterTypes(
            ClusterParser.ClusterJewelData jewels,
            Map<String, ModLoader.AfflictionNotable> modsByName,
            Map<String, ClusterParser.NotableInfo> infoByName,
            Map<String, ClusterParser.SkillEntry> skillByTag) throws JSONException {

        Set<String> largeClusterTags = skillByTag.keySet();

        Map<String, List<JSONObject>> prefixByTag = new LinkedHashMap<>();
        Map<String, List<JSONObject>> suffixByTag = new LinkedHashMap<>();
        for (String tag : largeClusterTags) {
            prefixByTag.put(tag, new ArrayList<>());
            suffixByTag.put(tag, new ArrayList<>());
        }

        for (ModLoader.AfflictionNotable mod : modsByName.values()) {
            for (ModLoader.SpawnTag st : mod.spawnTags()) {
                if (!largeClusterTags.contains(st.tag())) continue;

                int sortId = jewels.notableSortOrder().getOrDefault(mod.notableName(), -1);

                JSONObject entry = new JSONObject();
                entry.put("id", sortId);
                entry.put("name", mod.notableName());

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
        for (String tag : largeClusterTags) {
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

    private static JSONObject buildNotableIds(
            ClusterParser.ClusterJewelData jewels,
            Map<String, ModLoader.AfflictionNotable> modsByName,
            Map<String, ClusterParser.NotableInfo> infoByName) throws JSONException {

        JSONObject root = new JSONObject();

        for (Map.Entry<String, Integer> e : jewels.notableSortOrder().entrySet()) {
            String name = e.getKey();

            ClusterParser.NotableInfo ni = infoByName.get(name);
            ModLoader.AfflictionNotable mod = modsByName.get(name);

            JSONObject n = new JSONObject();
            n.put("id", e.getValue());
            n.put("name", name);

            JSONArray statsArr = new JSONArray();
            if (ni != null) for (String s : ni.stats()) statsArr.put(s);
            n.put("stats", statsArr);

            JSONArray placementsArr = new JSONArray();
            if (ni != null) {
                for (ClusterParser.SkillPlacement p : ni.placements()) {
                    JSONObject pl = new JSONObject();
                    pl.put("size", p.size());
                    pl.put("tag", p.tag());
                    placementsArr.put(pl);
                }
            }
            n.put("placements", placementsArr);

            if (mod != null) {
                JSONArray spawnArr = new JSONArray();
                for (ModLoader.SpawnTag st : mod.spawnTags()) {
                    JSONObject t = new JSONObject();
                    t.put("tag", st.tag());
                    t.put("weight", st.weight());
                    spawnArr.put(t);
                }
                n.put("spawn_tags", spawnArr);

                JSONArray implArr = new JSONArray();
                for (String s : mod.implicitTags()) implArr.put(s);
                n.put("implicit_tags", implArr);

                n.put("required_level", mod.requiredLevel());
            }

            root.put(name, n);
        }

        return root;
    }


    private static void write(Path path, JSONObject obj) throws IOException, JSONException {
        Files.writeString(path, obj.toString(2), StandardCharsets.UTF_8);
    }
}