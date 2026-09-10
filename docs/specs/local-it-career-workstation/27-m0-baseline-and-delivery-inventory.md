# M0 — Baseline, kiểm kê hiện trạng và danh sách triển khai

**Ngày:** 2026-09-04
**Trạng thái:** Hoàn thành M0 về tài liệu và kiểm kê; chưa triển khai M1.
**Phạm vi được yêu cầu:** hoàn thiện M0 sau lượt review kiến trúc/Ponytail. Không bao gồm sửa production code, chạy migration trên dữ liệu thật, commit hoặc publish.

**Tiếp nối sau M0:** Người dùng đã yêu cầu NEXT-01/M1 ở lượt tiếp theo. Xem [báo cáo M1](../../../reports/m1-workspace-resilience.md) và [runbook recovery](28-m1-backup-and-recovery.md); inventory dưới đây giữ nguyên snapshot trước M1 để truy vết, không phải danh sách thiếu cập nhật của code sau M1.

## 1. Hướng đi được chốt

Career Copilot là workstation local cho một người, ưu tiên IT và các vai trò liên quan tại Việt Nam/TP.HCM. Luồng giá trị là **JD → đối chiếu evidence → chuẩn bị CV → chọn bản xuất → ghi nhận application và kết quả**.

- Dữ liệu gốc được giữ; analysis/matching/draft là dữ liệu dẫn xuất, có nguồn và version cụ thể.
- Không account của sản phẩm, cloud storage/sync, multi-tenancy hoặc hosted agent service.
- Local-first mô tả lưu trữ và core offline; không hứa rằng một external AI runtime giữ prompt trên máy. Provider integration tương lai tuân theo [25](25-ai-provider-and-data-egress.md).
- Matching giải thích facts, gaps, unknowns và constraints; không dùng phần trăm fit để quyết định thay người dùng.
- Một codebase local, dashboard server loopback, CLI dùng chung các hàm domain/storage. Các service trong sơ đồ là ranh giới trách nhiệm, không yêu cầu process độc lập.
- Agent tạo proposal. Validation và quyền ghi/hành động do code kiểm soát. Có thể gộp role trong một runtime; grounding review vẫn là lượt độc lập.
- Không product-controlled submission nếu thiếu approval cho đúng destination và outgoing payload. Tự ghi lại việc người dùng đã nộp bên ngoài là `candidate-reported`, không tạo approval/receipt giả.
- Giữ dữ liệu và use case cũ đọc được; IT-first không loại bỏ profile nghề khác hoặc áp taxonomy đóng.
- n8n, connector/browser automation và provider integration không phải điều kiện để core hoạt động.

## 2. Phạm vi release đầu của hướng mới

Đây là danh sách ưu tiên để lập kế hoạch, không phải tuyên bố các tính năng đã tồn tại.

| Giữ trong release đầu | Giới hạn cụ thể |
| --- | --- |
| Intake | Paste và file text/Markdown; giữ raw/provenance. Không mở rộng portal fetch trước khi có review riêng. |
| Profile | Source + revision bất biến, evidence đơn giản bằng ID/quote, user confirmation. Không graph engine. |
| Matching | Một JD và profile revision, requirement/evidence/gap/unknown rõ ràng; policy chung trước. |
| CV | Một loại tài liệu là CV theo JD; sửa draft, review độc lập, publish revision. Sửa nội dung đánh dấu cần review lại. |
| Export | Markdown hiện có; chốt một đường PDF local nếu cần cho dogfood trước khi gọi release là dùng được để nộp. Chưa làm nhiều renderer/template. |
| Application | Chọn document revision, lưu record nộp thủ công và outcome, phân biệt candidate-reported với system-observed. Không tự gửi. |
| UI | Mở rộng Profile và Job detail; giữ các route hiện có, không viết lại toàn bộ dashboard. |
| An toàn dữ liệu | Non-overwrite mặc định, cô lập lỗi, phát hiện ghi xung đột, backup/restore cơ bản trước migration/dogfood dữ liệu thật. |

**Hoãn khỏi release đầu:** browser submission assist; n8n/Gmail automation; nhiều document types; diff-based semantic claim reconciliation; fuzzy dedupe; ontology/role-policy engine; analytics nhiều chiều; mock interview/voice framework; desktop wrapper; framework agent; DB; worker/queue. Basic interview prep có thể là nhánh sau matching nếu được yêu cầu, không phải release gate.

Những mục “V1 supports” trong các spec chi tiết là phạm vi mục tiêu của capability đó, không mở rộng danh sách release này. Không xóa capability tương lai chỉ vì chưa triển khai ở release đầu.

## 3. Snapshot kiểm kê

Đối chiếu trên branch `slice-4-local-workspace`, ngày 2026-09-04. Đầu phiên, `docs/specs/` là nội dung untracked đã có sẵn. Không đổi branch, không đọc nội dung career data riêng tư, không sửa source/test/package hoặc dữ liệu người dùng.

Các đường dẫn dưới đây tương đối từ repository root; link dẫn đến source hiện tại. “Có” nghĩa đã tìm thấy trong code, không phải đã chạy lại test hoặc xác nhận đầy đủ target contract.

| Phần | Bằng chứng hiện tại | Tái sử dụng | Cần bổ sung |
| --- | --- | --- | --- |
| CLI | [src/cli.ts](../../../src/cli.ts) | `job analyze`/`prepare`, validate analysis/profile/decision, text/stdin/file/directory/URL inputs | Output hiện dùng `writeFile`; thêm non-overwrite, atomic output phù hợp, conflict và migration contract. |
| Normalize input | [src/job/input.ts](../../../src/job/input.ts), [resolve-input.ts](../../../src/job/resolve-input.ts) | RawJobContent, text/Markdown import, batch failures, explicit URL fetch | Immutable raw capture và retrieval metadata; URL path hiện có không phải connector đã được review. |
| Job analysis | [src/job/schema.ts](../../../src/job/schema.ts), [analyze-job skill](../../../skills/analyze-job/SKILL.md) | Parser và facts employment/location/requirements, semantic extraction tách khỏi CLI | Envelope/version, stable requirement IDs và source spans. |
| Profile | [schema](../../../src/profile/schema.ts), [storage](../../../src/profile/storage.ts), [analyze-profile skill](../../../skills/analyze-profile/SKILL.md) | CandidateProfile, source file, parser, save/read | Hiện thay thế file active; thêm immutable revisions, evidence và current pointer. |
| Decision | [schema](../../../src/decision/schema.ts), [storage](../../../src/decision/storage.ts), [assess-job skill](../../../skills/assess-job/SKILL.md) | `consider`/`clarify`/`not-ready`, decision JSON và CV Markdown | Khóa input versions, evidence IDs, stale detection; không coi legacy decision là MatchAssessment mới đầy đủ. |
| Workspace | [src/workspace/storage.ts](../../../src/workspace/storage.ts) | Job folders, safe ID pattern, source/raw, note, metadata, temp-file/rename, cảnh báo derived artifact hỏng | Cô lập raw job hỏng trong list; symlink/root checks; shared writer, conflict và recovery nhiều file. |
| Local server | [src/web/server.ts](../../../src/web/server.ts) | Loopback startup, Host/Origin checks, JSON limit, APIs jobs/profile/note, Markdown download | Mở rộng APIs theo contract mới; kiểm thử thêm scope mới, không coi localhost là sandbox agent. |
| Dashboard | [app](../../../public/app.js), [routes](../../../public/routes.js), [render](../../../public/render.js), [profile-form](../../../public/profile-form.js), [styles](../../../public/styles.css) | Hash routes, Profile grouped edit, JD detail, notes, CV list/download, refresh artifacts | Evidence/revision/review/status UI, manual outcome; giữ frontend hiện tại. |
| Dependency/runtime | [package.json](../../../package.json) | Node/TypeScript, `tsx --test`, native HTTP/browser; không runtime dependency | Không thêm framework chỉ để hiện thực tên component trong architecture. |
| Private paths | [.gitignore](../../../.gitignore) | Ignore data và private fixtures hiện có | Kiểm tra root/ignore mới, exports/logs/backup khi tạo; chưa có guard tự động đầy đủ. |

### Test inventory

| Test source | Phạm vi để kế thừa |
| --- | --- |
| [job-input.test.ts](../../../tests/job-input.test.ts) | Input resolution, CLI và analysis parsing. |
| [profile.test.ts](../../../tests/profile.test.ts) | Profile schema/storage/CLI. |
| [decision.test.ts](../../../tests/decision.test.ts) | Decision schema, persistence và CLI. |
| [workspace.test.ts](../../../tests/workspace.test.ts) | Local artifact storage, metadata/notes và HTTP behavior. |
| [web-smoke.test.ts](../../../tests/web-smoke.test.ts) | Controller/render/route assertions với browser harness; không thay browser E2E tương tác thật. |
| [profile-form.test.ts](../../../tests/profile-form.test.ts) | Form conversion, escaping và bảo toàn nhóm profile. |

M0 không chạy lại application tests/build vì chỉ sửa tài liệu. Không có kết luận mới về pass count, coverage, browser behavior, network isolation hoặc portal/provider hoạt động. Mỗi implementation plan phải chạy test phù hợp với thay đổi, không dùng kết quả report cũ làm bằng chứng hiện tại.

## 4. Mapping dữ liệu và compatibility

| Artifact đang có | Target | Quy tắc chuyển tiếp |
| --- | --- | --- |
| `data/profile/source.md` | Profile source | Giữ bytes/path provenance; không thay bằng extraction. |
| `data/profile/candidate-profile.json` | Profile revision đầu + current pointer | Import có preview/backup; không tự tạo evidence đã verified. |
| `data/jobs/<id>/source.md` | Raw capture | Legacy bytes giữ nguyên; capture mới giữ byte-for-byte input và ghi thêm `source.json` provenance. |
| `data/jobs/<id>/raw.json` | Normalized input + provenance | Giữ tương thích; metadata không biết phải để unknown, không bịa retrieval date. |
| `data/jobs/<id>/analysis.json` | Analysis revision | Giữ facts; chỉ thêm source links đã đối chiếu được. |
| `data/jobs/<id>/decision.json` | Legacy assessment | Giữ ý nghĩa decision; chưa có version/evidence mới thì ghi legacy, không nâng trạng thái ngầm. |
| `data/jobs/<id>/cv-draft.md` | `unverified-legacy` draft revision | Giữ prose; chưa reviewed/approved, phải review trước dùng vào package. |
| `data/jobs/<id>/notes.md` | Candidate note | Giữ riêng, không tự đưa vào prompt hoặc CV. |
| `data/raw/`, `data/analysis/` CLI outputs | Standalone legacy artifacts | Không tự gắn job/profile dựa vào tên file; người dùng chọn mapping khi import. |

Contract target chi tiết ở [03](03-domain-model-and-artifact-contracts.md). Không chạy migration trong M0; việc atomic rename từng file hiện có không chứng minh một transaction nhiều file hoặc chống lost update.

## 5. Danh sách triển khai theo thứ tự

| ID | Việc cần làm | Kế thừa | Đầu ra/điều kiện xong |
| --- | --- | --- | --- |
| NEXT-01 / M1 | Storage resilience + backup tối thiểu | Existing writers, parsers, workspace tests | Non-overwrite CLI; một raw job hỏng không phá list; conflict rõ ràng; copy/restore sample; test ghi lỗi giữ bản cũ. Chốt root/lock strategy cho CLI + server. |
| NEXT-02 / M2 | Profile revisions + evidence | Profile schema/form/skill | Chọn revision cụ thể; edit không đổi revision cũ; legacy import không giả verified; migration preview/backup. |
| NEXT-03 / M3 | Capture/provenance + exact duplicate hints | Job input/storage/analyzer | M3.1 delivers raw-before-analysis, explicit metadata/legacy health and advisory hash/URL hints; M3.2 still adds candidate-reviewed links. |
| NEXT-04 / M4 | Version-bound matching | Decision schema + assess-job | Mỗi positive match có requirement/evidence; unknown không thành gap chắc chắn; stale khi input đổi; eval fixtures. |
| NEXT-05 / M5 | Một CV workflow | `cv-draft.md`, current download/render UI | Draft → review độc lập → immutable revision; edit phải review lại; chốt Markdown/PDF tối thiểu cho dogfood. |
| NEXT-06 / M6 | Application archive/outcome thủ công | Job detail, notes | Record exact CV revision/destination khi biết; unknown giữ rõ; candidate-reported provenance; đọc được khi không có connector. M8 chỉ bổ sung analytics sau đó. |
| LATER-01 / M9 basic | Interview questions theo JD/profile | Validated matching/CV | Chỉ context đã chọn, không bịa kinh nghiệm; không phụ thuộc analytics/browser assist. |
| LATER-02 / M7 | Một browser connector nếu cần | Approval package contract sau khi thống nhất | Review source riêng, exact outgoing hashes, one-time attempt, stop/handoff/unknown; không tự retry ambiguous submit. |
| LATER-03 / M8 analytics | Counts rồi mới rates/reports | Manual outcome history | Sample/denominator/unknown rõ; chưa có dữ liệu thì không thêm báo cáo rộng. |
| LATER-04 / M3A | Chọn một automation và đánh giá Node/n8n | Stable core intake | Chứng minh giảm công việc, chọn adopt/defer; không build 15 workflow trước. |
| LATER-05 / M10 | Distribution hardening | Backup/restore đã có từ M1 | Clean-install/upgrade docs và recovery drill; n8n drill chỉ nếu đã adopt. |

Danh sách này là backlog có thứ tự. Không tự bắt đầu NEXT-01 từ việc hoàn thành M0. Plan thực thi tiếp theo phải nêu file scope, test, compatibility và acceptance riêng; không chạy lại các bước “create missing files” của slice cũ.

## 6. Quyết định kỹ thuật còn mở trước capability tương ứng

- **M1:** một shared mutation boundary, lock scope/lifetime, crash recovery và canonical hash representation. Ưu tiên cơ chế nhỏ dùng được cho CLI/server, không tạo transaction framework.
- **M2–M4:** thống nhất source/claim/evidence IDs, version và parser; policy chung trước, không role ontology engine.
- **M5:** format export đầu tiên; hash bytes của file đính kèm thực tế, tách preview khỏi outgoing attachment.
- **M6–M7:** thống nhất `package`/`bundle`, approval status/action và profile linkage giữa 03/08/09/11/12. 03 là nơi đặt schema chuẩn; các spec khác dùng lại. Trạng thái ví dụ hiện chưa là schema có thể execute. Manual historical record không buộc có approval giả.
- **Provider:** launcher nào thực sự enforce quyền khi tích hợp; skill handoff hiện tại không chứng minh sandbox/network enforcement. Giữ core offline và provider consent tách khỏi submission approval.

Đây là công việc thiết kế theo milestone, không phải M0 còn thiếu implementation. M0 chốt hướng/phạm vi và ghi rõ chỗ chưa chốt, không đóng băng toàn bộ JSON examples thành schema đã duyệt.

## 7. Những phát biểu cũ được thay thế hoặc giới hạn

| Nguồn | Phát biểu/phạm vi cũ | Quyết định hiện tại |
| --- | --- | --- |
| Root AGENTS.md trước M0 | Chỉ Slice 1, không profile/matching/CV/UI/application | Thay bằng hướng local IT/Vietnam và release nhỏ trong tài liệu này; hiện trạng đã có Slice 2–4. |
| Root AGENTS.md trước M0 | Support all professions, không technical role | IT-first UX, giữ free-text và compatibility; không taxonomy đóng. |
| [Slice 2–4 design](../../superpowers/specs/2026-08-25-career-copilot-slices-2-4-design.md) | Scope/exclusions của các slice cũ | Historical; data contracts cũ là đầu vào migration, không ràng buộc toàn bộ hướng mới. |
| [Slice 2 plan](../../superpowers/plans/2026-08-26-slice-2-candidate-profile.md), [Slice 3 plan](../../superpowers/plans/2026-08-26-slice-3-job-decision.md) | Các bước tạo schema/storage/skill chưa tồn tại | Files đã có; lập delta plan, không replay. |
| [Slice 4 plan](../../superpowers/plans/2026-08-26-slice-4-local-workspace.md) | Queue/evidence sheet và light palette ban đầu | Historical; dashboard redesign sau đó và UI hiện tại là baseline để kế thừa. |
| [Dashboard design](../../superpowers/specs/2026-08-29-career-copilot-dashboard-redesign-design.md), [plan](../../superpowers/plans/2026-08-29-career-copilot-dashboard-redesign.md) | Application tracking/export/automation ngoài phạm vi đợt redesign | Giữ như phạm vi lịch sử; khả năng tương lai theo M0, không yêu cầu redesign lại UI. |
| `reports/*.md` | Kết quả test/delivery và deferrals ở thời điểm cũ | Bằng chứng lịch sử, không phải trạng thái verification hiện tại hay approval mới. |
| Spec index trước M0 | Toàn bộ hướng chỉ là draft, chưa có baseline active | Foundation accepted; feature details vẫn proposed. |
| Roadmap trước M0 | M7 → M8 → M9; basic backup tận M10 | Manual outcomes sau archive, basic coaching sau matching; backup từ M1; browser assist là nhánh độc lập. |
| Các spec capability | “V1” gồm nhiều docs/dedupe/policies/screens | First-release subset tại mục 2 có hiệu lực; phần còn lại deferred. |
| “local-only” không giải thích egress | Có thể hiểu mọi AI đều chạy offline | Storage local, remote AI opt-in có disclosure; không product account/cloud sync. |

## 8. Kiểm tra hoàn tất M0

- [x] Root instructions, README và spec index thống nhất hướng mới, phân biệt hiện trạng với target.
- [x] Có inventory source/test/skill và mapping artifact legacy → target, không đọc dữ liệu riêng tư.
- [x] Có danh sách tái sử dụng, bổ sung, hoãn và thứ tự triển khai cụ thể.
- [x] Historical plans/designs/reports được đánh dấu; deprecated statements có nơi tham chiếu.
- [x] n8n giữ conditional; outcome/coaching không bị browser automation chặn; backup tối thiểu lên M1.
- [x] Những contract chi tiết còn mở được gắn milestone trước khi implement, không báo đã hoàn thành feature.

Verification của M0: kiểm tra diff tài liệu, local Markdown links và đối chiếu inventory với source. Không có application test/build hay migration được chạy trong M0; không tuyên bố runtime pass.
