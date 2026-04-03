import java.io.IOException;
import java.nio.file.*;
import java.util.*;

public class ClusterParser {

    public record SkillEntry(
            String id,
            String name,
            String icon,
            String masteryIcon,
            String tag,
            List<String> stats,
            List<String> enchants
    ) {
    }

    public record JewelDef(
            String name,
            String size,
            int sizeIndex,
            int minNodes,
            int maxNodes,
            List<Integer> smallIndices,
            List<Integer> notableIndices,
            List<Integer> socketIndices,
            int totalIndices,
            Map<String, SkillEntry> skills
    ) {
    }

    public record SkillPlacement(String size, String tag) {
    }

    public record NotableInfo(
            String name,
            int sortId,
            List<SkillPlacement> placements,
            List<String> stats
    ) {
    }

    public record JewelTypeInfo(String size, String tag, List<String> notableNames) {
    }

    public record ClusterJewelData(
            Map<String, JewelDef> jewels,
            Map<String, Integer> notableSortOrder,
            List<String> keystones,
            Map<Integer, Map<Integer, Integer>> orbitOffsets,
            List<NotableInfo> notableIndex,
            Map<String, List<JewelTypeInfo>> jewelTypeIndex,
            Map<Integer, NotableInfo> notableById
    ) {
    }

    private final String src;
    private int pos;

    private ClusterParser(String src) {
        this.src = src;
        this.pos = 0;
    }

    public static ClusterJewelData parseFile(Path path) throws IOException {
        return new ClusterParser(Files.readString(path)).parse();
    }

    private ClusterJewelData parse() {
        skipTo("return {");
        pos += "return {".length();

        Map<String, JewelDef> jewels = new LinkedHashMap<>();
        Map<String, Integer> notableSortOrder = new LinkedHashMap<>();
        List<String> keystones = new ArrayList<>();
        Map<Integer, Map<Integer, Integer>> orbitOffsets = new LinkedHashMap<>();

        while (pos < src.length()) {
            skipWhitespace();
            if (peek() == '}') break;

            String key = readKey();
            skipToEquals();
            pos++;

            switch (key) {
                case "jewels" -> jewels = readJewels();
                case "notableSortOrder" -> notableSortOrder = readStringIntMap();
                case "keystones" -> keystones = readStringArray();
                case "orbitOffsets" -> orbitOffsets = readOrbitOffsets();
                default -> skipValue();
            }
            skipComma();
        }

        List<NotableInfo> notableIndex = buildNotableIndex(jewels, notableSortOrder);
        Map<String, List<JewelTypeInfo>> jewelTypeIndex = buildJewelTypeIndex(jewels, notableSortOrder);

        Map<Integer, NotableInfo> notableById = new LinkedHashMap<>();
        for (NotableInfo n : notableIndex) {
            if (n.sortId() != -1) notableById.put(n.sortId(), n);
        }

        return new ClusterJewelData(jewels, notableSortOrder, keystones, orbitOffsets,
                notableIndex, jewelTypeIndex, Collections.unmodifiableMap(notableById));
    }

    private static List<NotableInfo> buildNotableIndex(
            Map<String, JewelDef> jewels,
            Map<String, Integer> notableSortOrder) {

        Map<String, List<SkillPlacement>> placements = new LinkedHashMap<>();
        Map<String, List<String>> statsByName = new LinkedHashMap<>();

        jewels.forEach((jewelName, jewel) ->
                jewel.skills().forEach((skillId, skill) -> {
                    placements.computeIfAbsent(skill.name(), k -> new ArrayList<>())
                            .add(new SkillPlacement(jewel.size(), skill.tag()));
                    statsByName.putIfAbsent(skill.name(), skill.stats());
                })
        );

        return placements.entrySet().stream()
                .map(e -> new NotableInfo(
                        e.getKey(),
                        notableSortOrder.getOrDefault(e.getKey(), -1),
                        e.getValue(),
                        statsByName.get(e.getKey())))
                .sorted(Comparator.comparingInt(n -> n.sortId() == -1 ? Integer.MAX_VALUE : n.sortId()))
                .toList();
    }

    private static Map<String, List<JewelTypeInfo>> buildJewelTypeIndex(
            Map<String, JewelDef> jewels,
            Map<String, Integer> notableSortOrder) {

        Map<String, Map<String, List<String>>> tagSizeNotables = new LinkedHashMap<>();

        jewels.forEach((jewelName, jewel) ->
                jewel.skills().forEach((skillId, skill) ->
                        tagSizeNotables
                                .computeIfAbsent(skill.tag(), t -> new LinkedHashMap<>())
                                .computeIfAbsent(jewel.size(), s -> new ArrayList<>())
                                .add(skill.name())
                )
        );

        Map<String, List<JewelTypeInfo>> result = new LinkedHashMap<>();
        tagSizeNotables.forEach((tag, sizeMap) -> {
            List<JewelTypeInfo> infos = new ArrayList<>();
            sizeMap.forEach((size, names) -> {
                names.sort(Comparator.comparingInt(n -> notableSortOrder.getOrDefault(n, Integer.MAX_VALUE)));
                infos.add(new JewelTypeInfo(size, tag, Collections.unmodifiableList(names)));
            });
            result.put(tag, Collections.unmodifiableList(infos));
        });

        return Collections.unmodifiableMap(result);
    }

    private Map<String, JewelDef> readJewels() {
        Map<String, JewelDef> map = new LinkedHashMap<>();
        expect('{');
        while (true) {
            skipWhitespace();
            if (peek() == '}') {
                pos++;
                break;
            }
            String jewelName = readKey();
            skipToEquals();
            pos++;
            map.put(jewelName, readJewelDef(jewelName));
            skipComma();
        }
        return map;
    }

    private JewelDef readJewelDef(String jewelName) {
        expect('{');
        String size = "";
        int sizeIndex = 0, minNodes = 0, maxNodes = 0, totalIndices = 0;
        List<Integer> small = new ArrayList<>(), notable = new ArrayList<>(), socket = new ArrayList<>();
        Map<String, SkillEntry> skills = new LinkedHashMap<>();

        while (true) {
            skipWhitespace();
            if (peek() == '}') {
                pos++;
                break;
            }
            String k = readKey();
            skipToEquals();
            pos++;
            switch (k) {
                case "size" -> size = readQuotedString();
                case "sizeIndex" -> sizeIndex = readInt();
                case "minNodes" -> minNodes = readInt();
                case "maxNodes" -> maxNodes = readInt();
                case "totalIndicies" -> totalIndices = readInt();
                case "smallIndicies" -> small = readIntArray();
                case "notableIndicies" -> notable = readIntArray();
                case "socketIndicies" -> socket = readIntArray();
                case "skills" -> skills = readSkills();
                default -> skipValue();
            }
            skipComma();
        }
        return new JewelDef(jewelName, size, sizeIndex, minNodes, maxNodes,
                small, notable, socket, totalIndices, skills);
    }

    private Map<String, SkillEntry> readSkills() {
        Map<String, SkillEntry> map = new LinkedHashMap<>();
        expect('{');
        while (true) {
            skipWhitespace();
            if (peek() == '}') {
                pos++;
                break;
            }
            String id = readKey();
            skipToEquals();
            pos++;
            map.put(id, readSkillEntry(id));
            skipComma();
        }
        return map;
    }

    private SkillEntry readSkillEntry(String id) {
        expect('{');
        String name = "", icon = "", masteryIcon = null, tag = "";
        List<String> stats = new ArrayList<>(), enchants = new ArrayList<>();

        while (true) {
            skipWhitespace();
            if (peek() == '}') {
                pos++;
                break;
            }
            String k = readKey();
            skipToEquals();
            pos++;
            switch (k) {
                case "name" -> name = readQuotedString();
                case "icon" -> icon = readQuotedString();
                case "masteryIcon" -> masteryIcon = readQuotedString();
                case "tag" -> tag = readQuotedString();
                case "stats" -> stats = readStringArray();
                case "enchant" -> enchants = readStringArray();
                default -> skipValue();
            }
            skipComma();
        }
        return new SkillEntry(id, name, icon, masteryIcon, tag, stats, enchants);
    }

    private Map<String, Integer> readStringIntMap() {
        Map<String, Integer> map = new LinkedHashMap<>();
        expect('{');
        while (true) {
            skipWhitespace();
            if (peek() == '}') {
                pos++;
                break;
            }
            String k = readKey();
            skipToEquals();
            pos++;
            map.put(k, readInt());
            skipComma();
        }
        return map;
    }

    private Map<Integer, Map<Integer, Integer>> readOrbitOffsets() {
        Map<Integer, Map<Integer, Integer>> map = new LinkedHashMap<>();
        expect('{');
        while (true) {
            skipWhitespace();
            if (peek() == '}') {
                pos++;
                break;
            }
            int nodeId = readBracketedInt();
            skipToEquals();
            pos++;
            map.put(nodeId, readIntIntMap());
            skipComma();
        }
        return map;
    }

    private Map<Integer, Integer> readIntIntMap() {
        Map<Integer, Integer> map = new LinkedHashMap<>();
        expect('{');
        while (true) {
            skipWhitespace();
            if (peek() == '}') {
                pos++;
                break;
            }
            int k = readBracketedInt();
            skipToEquals();
            pos++;
            map.put(k, readInt());
            skipComma();
        }
        return map;
    }

    private List<String> readStringArray() {
        List<String> list = new ArrayList<>();
        expect('{');
        while (true) {
            skipWhitespace();
            if (peek() == '}') {
                pos++;
                break;
            }
            list.add(readQuotedString());
            skipComma();
        }
        return list;
    }

    private List<Integer> readIntArray() {
        List<Integer> list = new ArrayList<>();
        expect('{');
        while (true) {
            skipWhitespace();
            if (peek() == '}') {
                pos++;
                break;
            }
            list.add(readInt());
            skipComma();
        }
        return list;
    }

    private String readQuotedString() {
        skipWhitespace();
        expect('"');
        StringBuilder sb = new StringBuilder();
        while (pos < src.length() && src.charAt(pos) != '"') {
            if (src.charAt(pos) == '\\' && pos + 1 < src.length() && src.charAt(pos + 1) == '"') {
                sb.append('"');
                pos += 2;
            } else {
                sb.append(src.charAt(pos++));
            }
        }
        expect('"');
        return sb.toString();
    }

    private String readKey() {
        skipWhitespace();
        if (peek() == '[') {
            pos++;
            String s = readQuotedString();
            expect(']');
            return s;
        }
        StringBuilder sb = new StringBuilder();
        while (pos < src.length() &&
                (Character.isLetterOrDigit(src.charAt(pos)) || src.charAt(pos) == '_')) {
            sb.append(src.charAt(pos++));
        }
        return sb.toString();
    }

    private int readInt() {
        skipWhitespace();
        StringBuilder sb = new StringBuilder();
        if (pos < src.length() && src.charAt(pos) == '-') sb.append(src.charAt(pos++));
        while (pos < src.length() && Character.isDigit(src.charAt(pos))) sb.append(src.charAt(pos++));
        return Integer.parseInt(sb.toString());
    }

    private int readBracketedInt() {
        skipWhitespace();
        expect('[');
        int v = readInt();
        expect(']');
        return v;
    }

    private void skipValue() {
        skipWhitespace();
        char c = peek();
        if (c == '"') {
            readQuotedString();
        } else if (c == '{') {
            skipTable();
        } else {
            while (pos < src.length()
                    && !Character.isWhitespace(src.charAt(pos))
                    && src.charAt(pos) != ','
                    && src.charAt(pos) != '}') {
                pos++;
            }
        }
    }

    private void skipTable() {
        expect('{');
        int depth = 1;
        while (pos < src.length() && depth > 0) {
            char c = src.charAt(pos++);
            if (c == '{') depth++;
            else if (c == '}') depth--;
            else if (c == '"') {
                while (pos < src.length()) {
                    char sc = src.charAt(pos++);
                    if (sc == '\\') pos++;
                    else if (sc == '"') break;
                }
            }
        }
    }

    private char peek() {
        skipWhitespace();
        return pos < src.length() ? src.charAt(pos) : 0;
    }

    private void expect(char c) {
        skipWhitespace();
        if (pos >= src.length() || src.charAt(pos) != c)
            throw new RuntimeException("Expected '" + c + "' at pos " + pos
                    + " but got '" + (pos < src.length() ? src.charAt(pos) : "EOF") + "'");
        pos++;
    }

    private void skipWhitespace() {
        while (pos < src.length() && Character.isWhitespace(src.charAt(pos))) pos++;
    }

    private void skipComma() {
        skipWhitespace();
        if (pos < src.length() && src.charAt(pos) == ',') pos++;
    }

    private void skipToEquals() {
        while (pos < src.length()) {
            char c = src.charAt(pos);
            if (c == '=') return;
            if (c == '}') throw new RuntimeException(
                    "Hit '}' before '=' at pos " + pos + " (context: ..."
                            + src.substring(Math.max(0, pos - 30), pos) + ")");
            pos++;
        }
        throw new RuntimeException("Could not find '=' -- reached end of input");
    }

    private void skipTo(String target) {
        int idx = src.indexOf(target, pos);
        if (idx < 0) throw new RuntimeException("Could not find: " + target);
        pos = idx;
    }
}