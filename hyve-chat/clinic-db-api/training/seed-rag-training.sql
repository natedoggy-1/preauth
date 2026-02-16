-- seed-rag-training.sql
-- Complete demo system seed: patients, coverage, clinical data, policies,
-- templates, preauth requests, payer contacts, and providers.
-- Designed for demonstrating the full RAG-first PA letter platform.
--
-- Run AFTER base migrations (001-004) and demo.sql.
-- Idempotent: uses ON CONFLICT to avoid duplicates.
--
-- Convention:  policy_key  = POL-{PAYER}-{SERVICE}-{SEQ}
--              template_key = TMPL-{TYPE}-{SERVICE}-{SEQ}

BEGIN;

-- ============================================================
-- 1. PROVIDERS  (additional specialists)
-- ============================================================

INSERT INTO demo.providers (
  tenant_id, facility_id, provider_id,
  first_name, last_name, credentials, specialty, npi,
  phone, fax, email, signature_name
) VALUES
(1,'FAC-DEMO','PROV-002','Angela','Torres','MD, FACS','Orthopedic Spine Surgery',
 '1122334455','(214) 555-0110','(214) 555-0111','atorres@newazaspine.com','Angela Torres, MD, FACS'),
(1,'FAC-DEMO','PROV-003','Michael','Reyes','DO, FAAPMR','Interventional Pain Management',
 '2233445566','(214) 555-0120','(214) 555-0121','mreyes@newazaspine.com','Michael Reyes, DO, FAAPMR'),
(1,'FAC-DEMO','PROV-004','Karen','Patel','MD','Orthopedic Surgery — Joints',
 '3344556677','(214) 555-0130','(214) 555-0131','kpatel@newazaspine.com','Karen Patel, MD')
ON CONFLICT (tenant_id, facility_id, provider_id) DO NOTHING;

-- ============================================================
-- 2. PAYER CONTACTS
-- ============================================================

INSERT INTO demo.payer_contacts (
  tenant_id, facility_id, contact_id, payer_id,
  contact_name, title, phone, fax, email, department, notes
) VALUES
(1,'FAC-DEMO','PC-BCBS-01','BCBS','Jennifer Martinez','PA Coordinator','(800) 441-9188 x4421','(800) 555-0001','jmartinez@bcbstx.com','Prior Authorization','Handles spine & ortho cases. Best to call before 2pm CST.'),
(1,'FAC-DEMO','PC-BCBS-02','BCBS','Dr. Richard Nguyen','Medical Director','(800) 441-9188 x6000','(800) 555-0001','rnguyen@bcbstx.com','Medical Review','Available for peer-to-peer reviews Tu/Th 1-4pm.'),
(1,'FAC-DEMO','PC-AETNA-01','AETNA','Amanda Foster','PA Specialist','(800) 624-0756 x2310','(800) 555-0002','afoster@aetna.com','Utilization Review','Spine and pain management cases.'),
(1,'FAC-DEMO','PC-AETNA-02','AETNA','Dr. James Okafor','Associate Medical Director','(800) 624-0756 x5000','(800) 555-0002','jokafor@aetna.com','Medical Review','Peer-to-peer available M/W/F 10am-12pm.'),
(1,'FAC-DEMO','PC-UHC-01','UHC','Patricia Wells','PA Intake Coordinator','(800) 842-3844 x1100','(800) 555-0004','pwells@uhc.com','Prior Auth Unit','Submit via Optum portal for fastest processing.'),
(1,'FAC-DEMO','PC-CIGNA-01','CIGNA','Steven Liu','Clinical Review Specialist','(800) 244-6224 x3305','(800) 555-0003','sliu@cigna.com','Clinical Review','Handles SCS and complex spine cases.'),
(1,'FAC-DEMO','PC-HUMANA-01','HUMANA','Diana Brooks','PA Coordinator','(800) 457-4708 x7200','(800) 555-0005','dbrooks@humana.com','Precertification','Responds within 48 hours to faxed requests.')
ON CONFLICT (tenant_id, facility_id, contact_id) DO NOTHING;

-- ============================================================
-- 3. PATIENTS
-- ============================================================

INSERT INTO demo.patients (
  tenant_id, facility_id, patient_id,
  first_name, last_name, dob, sex, phone,
  address_line1, city, state, zip, email
) VALUES
(1,'FAC-DEMO','PAT-1001','Maria','Santos','1962-08-22','F','(214) 555-2001',
 '4521 Elm Street','Dallas','TX','75201','maria.santos@email.com'),
(1,'FAC-DEMO','PAT-1002','James','Mitchell','1970-04-11','M','(214) 555-2002',
 '789 Oak Lane','Plano','TX','75024','james.mitchell@email.com'),
(1,'FAC-DEMO','PAT-1003','Lisa','Chen','1979-11-05','F','(214) 555-2003',
 '2100 Cedar Springs Rd','Dallas','TX','75201','lisa.chen@email.com'),
(1,'FAC-DEMO','PAT-1004','David','Thompson','1966-03-28','M','(972) 555-2004',
 '555 Greenville Ave','Richardson','TX','75080','david.thompson@email.com'),
(1,'FAC-DEMO','PAT-1005','Sarah','Williams','1977-06-15','F','(817) 555-2005',
 '1234 University Dr','Fort Worth','TX','76107','sarah.williams@email.com')
ON CONFLICT (tenant_id, facility_id, patient_id) DO NOTHING;

-- ============================================================
-- 4. COVERAGE  (each patient → different payer)
-- ============================================================

INSERT INTO demo.coverage (
  tenant_id, facility_id, coverage_id, patient_id, payer_id,
  member_id, group_id, plan_name,
  subscriber_name, subscriber_relationship,
  effective_date, is_active
) VALUES
-- Maria Santos → Aetna (TKA case)
(1,'FAC-DEMO','COV-1001','PAT-1001','AETNA',
 'AET-88712345','GRP-44210','Aetna Choice POS II',
 'Maria Santos','self','2023-01-01',true),
-- James Mitchell → UHC (lumbar fusion case)
(1,'FAC-DEMO','COV-1002','PAT-1002','UHC',
 'UHC-55643210','GRP-77820','UHC Choice Plus PPO',
 'James Mitchell','self','2023-01-01',true),
-- Lisa Chen → Cigna (SCS case)
(1,'FAC-DEMO','COV-1003','PAT-1003','CIGNA',
 'CGN-33198765','GRP-11560','Cigna Open Access Plus',
 'Lisa Chen','self','2022-06-01',true),
-- David Thompson → BCBS (cervical fusion case)
(1,'FAC-DEMO','COV-1004','PAT-1004','BCBS',
 'BCB-99456789','GRP-33440','BCBSTX Blue Choice PPO',
 'David Thompson','self','2023-01-01',true),
-- Sarah Williams → Humana (ESI case)
(1,'FAC-DEMO','COV-1005','PAT-1005','HUMANA',
 'HUM-77234561','GRP-55890','Humana Gold Plus HMO',
 'Sarah Williams','self','2023-07-01',true)
ON CONFLICT (tenant_id, facility_id, coverage_id) DO NOTHING;

-- ============================================================
-- 5. PROBLEMS  (ICD-10 diagnoses per patient)
-- ============================================================

INSERT INTO demo.problems (
  tenant_id, facility_id, problem_id, patient_id,
  icd10_code, description, onset_date, is_active
) VALUES
-- Maria Santos (TKA — knee OA)
(1,'FAC-DEMO','PRB-1001','PAT-1001','M17.11','Primary osteoarthritis, right knee','2021-03-15',true),
(1,'FAC-DEMO','PRB-1002','PAT-1001','M17.12','Primary osteoarthritis, left knee','2022-09-10',true),
(1,'FAC-DEMO','PRB-1003','PAT-1001','M25.561','Pain in right knee','2021-03-15',true),
(1,'FAC-DEMO','PRB-1004','PAT-1001','E11.9','Type 2 diabetes mellitus without complications','2018-05-01',true),
-- James Mitchell (lumbar fusion — DDD + stenosis)
(1,'FAC-DEMO','PRB-2001','PAT-1002','M51.16','Intervertebral disc degeneration, lumbar region','2022-01-20',true),
(1,'FAC-DEMO','PRB-2002','PAT-1002','M48.06','Spinal stenosis, lumbar region','2022-06-15',true),
(1,'FAC-DEMO','PRB-2003','PAT-1002','M54.5','Low back pain','2021-08-01',true),
(1,'FAC-DEMO','PRB-2004','PAT-1002','M54.41','Sciatica, right side','2022-01-20',true),
(1,'FAC-DEMO','PRB-2005','PAT-1002','G89.29','Other chronic pain','2022-01-20',true),
-- Lisa Chen (SCS — failed back surgery syndrome)
(1,'FAC-DEMO','PRB-3001','PAT-1003','M96.1','Postlaminectomy syndrome','2022-04-01',true),
(1,'FAC-DEMO','PRB-3002','PAT-1003','G89.4','Chronic pain syndrome','2022-04-01',true),
(1,'FAC-DEMO','PRB-3003','PAT-1003','M54.5','Low back pain','2021-01-15',true),
(1,'FAC-DEMO','PRB-3004','PAT-1003','M54.41','Sciatica, right side','2022-04-01',true),
(1,'FAC-DEMO','PRB-3005','PAT-1003','F41.1','Generalized anxiety disorder','2023-02-01',true),
-- David Thompson (cervical fusion — disc herniation)
(1,'FAC-DEMO','PRB-4001','PAT-1004','M50.121','Cervical disc disorder at C5-C6, radiculopathy','2023-05-10',true),
(1,'FAC-DEMO','PRB-4002','PAT-1004','M54.12','Radiculopathy, cervical region','2023-05-10',true),
(1,'FAC-DEMO','PRB-4003','PAT-1004','M54.2','Cervicalgia','2023-03-01',true),
(1,'FAC-DEMO','PRB-4004','PAT-1004','G54.2','Cervical root disorders','2023-05-10',true),
-- Sarah Williams (ESI — lumbar radiculopathy)
(1,'FAC-DEMO','PRB-5001','PAT-1005','M54.41','Sciatica, right side','2024-06-01',true),
(1,'FAC-DEMO','PRB-5002','PAT-1005','M51.16','Intervertebral disc degeneration, lumbar region','2024-06-01',true),
(1,'FAC-DEMO','PRB-5003','PAT-1005','M54.5','Low back pain','2024-04-15',true)
ON CONFLICT (tenant_id, facility_id, problem_id) DO NOTHING;

-- ============================================================
-- 6. ENCOUNTERS  (visit notes)
-- ============================================================

INSERT INTO demo.encounters (
  tenant_id, facility_id, encounter_id, patient_id,
  encounter_date, encounter_type, provider_id, provider_name, summary
) VALUES
-- Maria Santos encounters
(1,'FAC-DEMO','ENC-1001','PAT-1001','2024-09-12','office_visit','PROV-004','Karen Patel, MD',
 'Patient presents with worsening right knee pain over the past 3 years. Reports difficulty with stairs, prolonged standing, and walking > 1 block. Physical exam: moderate effusion right knee, crepitus with ROM, varus alignment. ROM: flexion 95°, extension -5°. Weight-bearing X-rays obtained. Kellgren-Lawrence Grade 4 with complete medial joint space loss. Discussed surgical options.'),
(1,'FAC-DEMO','ENC-1002','PAT-1001','2024-11-15','office_visit','PROV-004','Karen Patel, MD',
 'Follow-up visit. Patient completed 16 sessions of physical therapy with minimal improvement. WOMAC score: 72/96 (severe). Continues to use a cane for ambulation. Unable to perform household chores or drive comfortably. Discussed TKA as next treatment option. Patient agrees to proceed. Will submit prior authorization to Aetna.'),
(1,'FAC-DEMO','ENC-1003','PAT-1001','2025-01-10','office_visit','PROV-004','Karen Patel, MD',
 'Pre-operative planning visit. Patient has completed all conservative treatment requirements per Aetna policy. HbA1c 6.8% (controlled). BMI 31.2. Cardiac clearance obtained. Discussed surgical risks, benefits, and alternatives. Patient consents to right total knee arthroplasty.'),

-- James Mitchell encounters
(1,'FAC-DEMO','ENC-2001','PAT-1002','2024-05-20','office_visit','PROV-002','Angela Torres, MD, FACS',
 'New patient evaluation. 54-year-old male with 2-year history of progressive low back pain radiating to right lower extremity. Pain rated 8/10, worse with standing and walking. Neurological exam: diminished ankle reflex right side, positive straight leg raise at 40°. Sensory deficit L5 dermatome. MRI ordered.'),
(1,'FAC-DEMO','ENC-2002','PAT-1002','2024-06-10','office_visit','PROV-002','Angela Torres, MD, FACS',
 'MRI review. L4-L5: Grade II degenerative spondylolisthesis with bilateral foraminal stenosis. L3-L4: moderate central stenosis. Findings correlate with clinical presentation. Initiated conservative management: referral to PT, prescribed gabapentin 300mg TID, naproxen 500mg BID. PHQ-9 screening: score 8 (mild). Will reassess in 6 weeks.'),
(1,'FAC-DEMO','ENC-2003','PAT-1002','2024-09-15','office_visit','PROV-002','Angela Torres, MD, FACS',
 'Follow-up after 12 weeks of PT (24 visits). Patient reports 20% improvement initially but has plateaued. ODI score: 52% (severe disability). Right leg numbness worsening. Gabapentin increased to 600mg TID. Referred for lumbar ESI series.'),
(1,'FAC-DEMO','ENC-2004','PAT-1002','2024-12-10','office_visit','PROV-002','Angela Torres, MD, FACS',
 'Post-ESI follow-up. Patient received 2 L4-L5 transforaminal ESIs (10/15 and 11/20). First injection: 40% relief lasting 10 days. Second injection: 25% relief lasting 5 days. Diminishing returns. ODI unchanged at 52%. HbA1c 7.2%. Recommend surgical consultation for L4-L5 posterolateral fusion with decompression. Will submit PA to UHC.'),

-- Lisa Chen encounters
(1,'FAC-DEMO','ENC-3001','PAT-1003','2024-01-15','office_visit','PROV-003','Michael Reyes, DO, FAAPMR',
 'New patient evaluation for chronic low back pain. History: L4-L5 laminectomy in 2022 at outside facility. Developed postlaminectomy syndrome with persistent bilateral leg pain worse on right. Pain duration 22 months. VAS 8/10. Currently on oxycodone 10mg Q8H, gabapentin 800mg TID, duloxetine 60mg daily. Unable to work as school teacher since surgery. Discussed multimodal pain management plan.'),
(1,'FAC-DEMO','ENC-3002','PAT-1003','2024-04-20','office_visit','PROV-003','Michael Reyes, DO, FAAPMR',
 'Follow-up after medial branch blocks and PT. Completed 18 PT sessions with aquatic therapy — marginal benefit. MBBs at L3-L5 bilaterally: 30% relief lasting 3 days. Failed criteria for radiofrequency ablation. Discussed spinal cord stimulation as next option. Referred for psychological evaluation.'),
(1,'FAC-DEMO','ENC-3003','PAT-1003','2024-07-10','office_visit','PROV-003','Michael Reyes, DO, FAAPMR',
 'Psych eval completed by Dr. Elizabeth Warren, PhD on 06/25/2024. Results: No untreated psychiatric contraindications. GAD managed with sertraline. Cleared for SCS candidacy. Discussed trial procedure, expectations, and permanent implant criteria. Patient consents to SCS trial.'),
(1,'FAC-DEMO','ENC-3004','PAT-1003','2024-09-05','office_visit','PROV-003','Michael Reyes, DO, FAAPMR',
 'SCS trial results review. Trial performed 08/20-08/27/2024, 7-day trial with percutaneous leads at T8-T10. Results: 65% pain relief (VAS decreased from 8 to 3). Functional improvement: able to walk 4 blocks vs 1 block at baseline. Able to sit for 45 minutes vs 15 minutes. Patient highly satisfied. Recommend permanent SCS implantation. Will submit PA to Cigna.'),

-- David Thompson encounters
(1,'FAC-DEMO','ENC-4001','PAT-1004','2024-08-05','office_visit','PROV-002','Angela Torres, MD, FACS',
 'New patient. 58M with 5-month history of right arm pain and numbness radiating from neck to thumb and index finger. Neck pain rated 6/10, arm pain 7/10. Exam: diminished biceps reflex right, decreased sensation C6 dermatome, positive Spurling test right. Grip strength reduced 4/5 right. MRI cervical spine ordered.'),
(1,'FAC-DEMO','ENC-4002','PAT-1004','2024-08-25','office_visit','PROV-002','Angela Torres, MD, FACS',
 'MRI results: C5-C6 right paracentral disc herniation with moderate foraminal stenosis and C6 nerve root compression. C4-C5: mild disc bulge without nerve impingement. Findings correlate with C6 radiculopathy. Initiated conservative management: cervical epidural, PT referral, oral prednisone taper.'),
(1,'FAC-DEMO','ENC-4003','PAT-1004','2024-11-20','office_visit','PROV-002','Angela Torres, MD, FACS',
 'Follow-up after 12 weeks conservative care. Completed 20 PT sessions — improved neck ROM but persistent right arm radiculopathy. Cervical ESI at C5-C6 on 10/01: 50% relief for 2 weeks then symptoms returned. NDI score: 42% (severe). Progressive grip weakness now 3+/5 right. EMG confirms active C6 radiculopathy. Recommend C5-C6 ACDF. Will submit PA to BCBS.'),

-- Sarah Williams encounters
(1,'FAC-DEMO','ENC-5001','PAT-1005','2024-10-01','office_visit','PROV-003','Michael Reyes, DO, FAAPMR',
 'New patient. 47F with 4-month history of low back pain radiating to right posterior thigh and calf. Pain 7/10. Onset after gardening. Exam: positive SLR at 50° right, intact strength and reflexes. Sensory: decreased light touch S1 dermatome right. MRI lumbar spine ordered.'),
(1,'FAC-DEMO','ENC-5002','PAT-1005','2024-10-15','office_visit','PROV-003','Michael Reyes, DO, FAAPMR',
 'MRI results: L5-S1 right paracentral disc protrusion contacting the traversing S1 nerve root. No stenosis at other levels. Started on meloxicam 15mg daily and gabapentin 300mg BID. Referred to PT.'),
(1,'FAC-DEMO','ENC-5003','PAT-1005','2025-01-08','office_visit','PROV-003','Michael Reyes, DO, FAAPMR',
 'Follow-up after 10 weeks of PT (16 sessions). Patient reports some improvement in back pain but persistent right leg radiculopathy. VAS: back 4/10, leg 6/10. Tried meloxicam (minimal relief), gabapentin titrated to 600mg BID (partial relief, side effects of drowsiness). Recommend right L5-S1 transforaminal ESI under fluoroscopic guidance. Will submit PA to Humana.')
ON CONFLICT (tenant_id, facility_id, encounter_id) DO NOTHING;

-- ============================================================
-- 7. IMAGING
-- ============================================================

INSERT INTO demo.imaging (
  tenant_id, facility_id, imaging_id, patient_id,
  modality, body_part, imaging_date, ordering_provider,
  impression, item
) VALUES
-- Maria Santos
(1,'FAC-DEMO','IMG-1001','PAT-1001','X-Ray','Right Knee','2024-09-12','PROV-004',
 'Severe tricompartmental osteoarthritis. Kellgren-Lawrence Grade 4. Complete loss of medial joint space. Large marginal osteophytes. Varus alignment 8 degrees. Subchondral sclerosis and cyst formation.',
 'Weight-bearing AP, lateral, sunrise views of right knee'),
(1,'FAC-DEMO','IMG-1002','PAT-1001','X-Ray','Left Knee','2024-09-12','PROV-004',
 'Moderate osteoarthritis. Kellgren-Lawrence Grade 2. Mild medial joint space narrowing. Small osteophytes. No malalignment.',
 'Weight-bearing AP and lateral views of left knee'),

-- James Mitchell
(1,'FAC-DEMO','IMG-2001','PAT-1002','MRI','Lumbar Spine','2024-06-05','PROV-002',
 'L4-L5: Grade II degenerative spondylolisthesis (6mm anterolisthesis). Bilateral foraminal stenosis, moderate-to-severe, with compression of the exiting L4 nerve roots bilaterally. Disc desiccation and loss of disc height. L3-L4: Moderate central stenosis secondary to ligamentum flavum hypertrophy. Mild facet arthropathy. L5-S1: Mild disc bulge, no significant stenosis.',
 'MRI lumbar spine without contrast'),
(1,'FAC-DEMO','IMG-2002','PAT-1002','X-Ray','Lumbar Spine','2024-12-01','PROV-002',
 'Flexion/extension views: L4-L5 dynamic instability with 4mm translation on flexion. Spondylolisthesis confirmed. Disc space narrowing L4-L5.',
 'Standing flexion/extension lateral views'),

-- Lisa Chen
(1,'FAC-DEMO','IMG-3001','PAT-1003','MRI','Lumbar Spine','2024-01-10','PROV-003',
 'Post-surgical changes at L4-L5 status post laminectomy. Epidural fibrosis at surgical site. No recurrent disc herniation. Mild facet hypertrophy L3-L4 and L5-S1. No new structural compressive lesion identified.',
 'MRI lumbar spine with and without contrast'),

-- David Thompson
(1,'FAC-DEMO','IMG-4001','PAT-1004','MRI','Cervical Spine','2024-08-20','PROV-002',
 'C5-C6: Right paracentral disc herniation measuring 5mm with moderate right foraminal stenosis. Right C6 nerve root compression with edema. Mild central canal narrowing. C4-C5: Mild broad-based disc bulge without significant stenosis. C3-C4, C6-C7: Normal.',
 'MRI cervical spine without contrast'),
(1,'FAC-DEMO','IMG-4002','PAT-1004','EMG/NCS','Right Upper Extremity','2024-11-10','PROV-002',
 'Electrodiagnostic study demonstrates active right C6 radiculopathy with fibrillation potentials and positive sharp waves in C6-innervated muscles (biceps, brachioradialis, pronator teres). Chronic reinnervation changes noted. No evidence of peripheral neuropathy or plexopathy.',
 'EMG/NCS right upper extremity'),

-- Sarah Williams
(1,'FAC-DEMO','IMG-5001','PAT-1005','MRI','Lumbar Spine','2024-10-10','PROV-003',
 'L5-S1: Right paracentral disc protrusion measuring 4mm, contacting and mildly displacing the traversing right S1 nerve root. No significant central stenosis. L4-L5: Mild disc bulge, no nerve impingement. Remaining levels unremarkable.',
 'MRI lumbar spine without contrast')
ON CONFLICT (tenant_id, facility_id, imaging_id) DO NOTHING;

-- ============================================================
-- 8. THERAPY RECORDS
-- ============================================================

INSERT INTO demo.therapy (
  tenant_id, facility_id, therapy_id, patient_id,
  therapy_type, start_date, end_date, total_visits,
  frequency, response, therapy_item, provider_name
) VALUES
-- Maria Santos
(1,'FAC-DEMO','THR-1001','PAT-1001','Physical Therapy','2024-06-01','2024-08-30',16,
 '2x/week','Failed — minimal functional improvement. WOMAC improved from 78 to 72 (clinically insignificant). Patient unable to tolerate closed-chain exercises due to pain.',
 'PT — right knee strengthening, ROM, gait training','Dallas PT Associates'),
(1,'FAC-DEMO','THR-1002','PAT-1001','Corticosteroid Injection','2024-04-15','2024-04-15',1,
 'Single injection','Partial — 50% pain relief for 3 weeks, then returned to baseline. Right knee triamcinolone 40mg intra-articular.',
 'Right knee intra-articular corticosteroid injection','Karen Patel, MD'),
(1,'FAC-DEMO','THR-1003','PAT-1001','Viscosupplementation','2024-07-10','2024-08-07',3,
 'Weekly x3','Failed — no significant pain relief after completing full series. Synvisc-One injections right knee.',
 'Hyaluronic acid injection series (3 injections)','Karen Patel, MD'),

-- James Mitchell
(1,'FAC-DEMO','THR-2001','PAT-1002','Physical Therapy','2024-06-15','2024-09-10',24,
 '2x/week','Failed — 20% initial improvement that plateaued. Core stabilization and McKenzie protocol. Unable to progress to higher-intensity exercises due to radicular symptoms.',
 'PT — lumbar stabilization, core strengthening, nerve glides','Plano Spine Rehab'),
(1,'FAC-DEMO','THR-2002','PAT-1002','Epidural Steroid Injection','2024-10-15','2024-10-15',1,
 'Single injection','Partial — 40% pain relief lasting 10 days. L4-L5 right transforaminal ESI under fluoroscopy. Dexamethasone 10mg + bupivacaine 2ml.',
 'L4-L5 transforaminal ESI #1','Michael Reyes, DO'),
(1,'FAC-DEMO','THR-2003','PAT-1002','Epidural Steroid Injection','2024-11-20','2024-11-20',1,
 'Single injection','Failed — 25% relief lasting 5 days only. Diminishing response. L4-L5 right transforaminal ESI under fluoroscopy.',
 'L4-L5 transforaminal ESI #2','Michael Reyes, DO'),

-- Lisa Chen
(1,'FAC-DEMO','THR-3001','PAT-1003','Physical Therapy','2024-02-01','2024-04-15',18,
 '2-3x/week','Failed — marginal benefit. Aquatic therapy and land-based exercises. Could not tolerate lumbar extension activities. Pain remained 7-8/10.',
 'PT — aquatic therapy, core stabilization, pain neuroscience education','Spine & Sport Rehab'),
(1,'FAC-DEMO','THR-3002','PAT-1003','Medial Branch Block','2024-05-10','2024-05-10',1,
 'Diagnostic block','Failed — 30% relief lasting 3 days. Did not meet threshold for radiofrequency ablation (requires >= 50% relief). L3-L5 bilateral MBBs.',
 'L3-L5 bilateral medial branch blocks (diagnostic)','Michael Reyes, DO'),
(1,'FAC-DEMO','THR-3003','PAT-1003','TENS Unit','2024-03-01','2024-08-01',NULL,
 'Daily home use','Partial — mild relief during use, no lasting benefit. Used 4 hours/day for 5 months.',
 'Transcutaneous electrical nerve stimulation (home unit)','Michael Reyes, DO'),
(1,'FAC-DEMO','THR-3004','PAT-1003','Psychological Therapy','2024-04-01','2024-06-15',10,
 'Weekly','Completed — pain coping strategies, CBT for chronic pain. Cleared for SCS candidacy. GAD managed with medication.',
 'Cognitive behavioral therapy for chronic pain','Elizabeth Warren, PhD'),

-- David Thompson
(1,'FAC-DEMO','THR-4001','PAT-1004','Physical Therapy','2024-09-01','2024-11-15',20,
 '2x/week','Partial — improved neck ROM (flexion 30°→45°, rotation 40°→55°) but persistent right arm radiculopathy unchanged. Unable to progress strengthening due to arm weakness.',
 'PT — cervical traction, ROM, postural training, nerve glides','North Texas Spine Therapy'),
(1,'FAC-DEMO','THR-4002','PAT-1004','Epidural Steroid Injection','2024-10-01','2024-10-01',1,
 'Single injection','Partial — 50% relief for 2 weeks then symptoms returned to baseline. C5-C6 interlaminar ESI under fluoroscopy.',
 'C5-C6 cervical interlaminar ESI','Michael Reyes, DO'),

-- Sarah Williams
(1,'FAC-DEMO','THR-5001','PAT-1005','Physical Therapy','2024-10-20','2025-01-05',16,
 '2x/week','Partial — back pain improved (7→4/10) but right leg radiculopathy persistent (7→6/10). McKenzie protocol, core stabilization, nerve mobilization.',
 'PT — lumbar stabilization, McKenzie, nerve glides','Fort Worth Physical Therapy')
ON CONFLICT (tenant_id, facility_id, therapy_id) DO NOTHING;

-- ============================================================
-- 9. MEDICATION TRIALS
-- ============================================================

INSERT INTO demo.med_trials (
  tenant_id, facility_id, med_trial_id, patient_id,
  medication, dose, start_date, end_date, outcome, notes
) VALUES
-- Maria Santos
(1,'FAC-DEMO','MED-1001','PAT-1001','Naproxen','500mg BID','2023-06-01','2024-09-01','Inadequate',
 'Mild pain relief initially, inadequate for functional improvement. GI discomfort at higher doses.'),
(1,'FAC-DEMO','MED-1002','PAT-1001','Acetaminophen','1000mg TID','2023-06-01',NULL,'Inadequate',
 'Minimal pain relief. Used as adjunct. Ongoing.'),
(1,'FAC-DEMO','MED-1003','PAT-1001','Meloxicam','15mg daily','2024-01-15','2024-06-01','Inadequate',
 'Better tolerated than naproxen but insufficient pain control for ADL performance.'),
(1,'FAC-DEMO','MED-1004','PAT-1001','Metformin','1000mg BID','2018-05-01',NULL,'Therapeutic',
 'For type 2 diabetes management. HbA1c 6.8% (well controlled).'),

-- James Mitchell
(1,'FAC-DEMO','MED-2001','PAT-1002','Naproxen','500mg BID','2024-06-10','2024-09-15','Inadequate',
 'Mild relief of back pain, no improvement in radicular symptoms.'),
(1,'FAC-DEMO','MED-2002','PAT-1002','Gabapentin','300mg TID → 600mg TID','2024-06-10',NULL,'Partial',
 'Partial relief of neuropathic leg pain at higher dose. Side effects: drowsiness, dizziness.'),
(1,'FAC-DEMO','MED-2003','PAT-1002','Cyclobenzaprine','10mg QHS','2024-06-10','2024-08-01','Inadequate',
 'Mild muscle relaxation, no significant functional improvement. Discontinued due to excessive daytime sedation.'),
(1,'FAC-DEMO','MED-2004','PAT-1002','Meloxicam','15mg daily','2024-09-20',NULL,'Inadequate',
 'Switched from naproxen. Similar inadequate response for radicular symptoms.'),

-- Lisa Chen
(1,'FAC-DEMO','MED-3001','PAT-1003','Oxycodone','10mg Q8H','2022-06-01',NULL,'Partial',
 'Partial pain relief (VAS 8→6). Concerns about long-term opioid use. Stable dose, no dose escalation.'),
(1,'FAC-DEMO','MED-3002','PAT-1003','Gabapentin','800mg TID','2022-06-01',NULL,'Partial',
 'Moderate neuropathic pain relief. Side effects managed (mild dizziness).'),
(1,'FAC-DEMO','MED-3003','PAT-1003','Duloxetine','60mg daily','2022-08-01',NULL,'Partial',
 'Some improvement in pain and mood. Complements gabapentin for neuropathic component.'),
(1,'FAC-DEMO','MED-3004','PAT-1003','Sertraline','100mg daily','2023-02-01',NULL,'Therapeutic',
 'For generalized anxiety disorder. Well controlled.'),
(1,'FAC-DEMO','MED-3005','PAT-1003','Naproxen','500mg BID','2022-04-01','2022-08-01','Inadequate',
 'Minimal effect on neuropathic pain. Discontinued.'),
(1,'FAC-DEMO','MED-3006','PAT-1003','Tramadol','50mg Q6H PRN','2022-06-01','2022-10-01','Inadequate',
 'Insufficient relief. Replaced with oxycodone.'),

-- David Thompson
(1,'FAC-DEMO','MED-4001','PAT-1004','Prednisone','Medrol dose pack','2024-08-25','2024-09-01','Partial',
 '60% relief of arm pain during taper, symptoms returned within 1 week of completing pack.'),
(1,'FAC-DEMO','MED-4002','PAT-1004','Gabapentin','300mg BID → 600mg BID','2024-09-01',NULL,'Partial',
 'Partial reduction in arm numbness/tingling. Pain persists.'),
(1,'FAC-DEMO','MED-4003','PAT-1004','Naproxen','500mg BID','2024-09-01','2024-11-01','Inadequate',
 'Mild neck pain relief but no improvement in radicular arm symptoms.'),

-- Sarah Williams
(1,'FAC-DEMO','MED-5001','PAT-1005','Meloxicam','15mg daily','2024-10-15',NULL,'Partial',
 'Mild improvement in back pain, minimal effect on leg pain.'),
(1,'FAC-DEMO','MED-5002','PAT-1005','Gabapentin','300mg BID → 600mg BID','2024-10-15',NULL,'Partial',
 'Partial relief of radicular symptoms. Dose-limited by drowsiness.')
ON CONFLICT (tenant_id, facility_id, med_trial_id) DO NOTHING;

-- ============================================================
-- 10. PREAUTH REQUESTS
-- ============================================================

INSERT INTO demo.preauth_requests (
  tenant_id, facility_id, request_id, patient_id,
  payer_id, provider_id, coverage_id,
  cpt_code, cpt_description, icd10_code, icd10_codes,
  service_name, service_key,
  requested_dos, requested_units, priority, status,
  medical_necessity_summary, clinical_question
) VALUES
-- Maria Santos → Aetna TKA
(1,'FAC-DEMO','REQ-1001','PAT-1001','AETNA','PROV-004','COV-1001',
 '27447','Total knee arthroplasty','M17.11','{"M17.11","M25.561"}',
 'Total Knee Arthroplasty — Right','orthopedic_surgery',
 '2025-03-15',1,'standard','pending',
 'Right TKA for severe primary osteoarthritis (KL Grade 4) after failure of PT (16 visits), corticosteroid injection, and viscosupplementation series. WOMAC 72/96.',
 'Does the patient meet Aetna criteria for total knee arthroplasty?'),

-- James Mitchell → UHC Lumbar Fusion
(1,'FAC-DEMO','REQ-1002','PAT-1002','UHC','PROV-002','COV-1002',
 '22612','Lumbar posterolateral fusion','M51.16','{"M51.16","M48.06","M54.41","M43.16"}',
 'L4-L5 Posterolateral Fusion with Decompression','spine_surgery',
 '2025-02-20',1,'standard','pending',
 'L4-L5 fusion for Grade II spondylolisthesis with bilateral foraminal stenosis after failure of 12 weeks PT, 2 ESIs, and multimodal pharmacotherapy. ODI 52%.',
 'Does the patient meet UHC criteria for lumbar spinal fusion?'),

-- Lisa Chen → Cigna SCS
(1,'FAC-DEMO','REQ-1003','PAT-1003','CIGNA','PROV-003','COV-1003',
 '63685','Spinal cord stimulator implantation','M96.1','{"M96.1","G89.4","M54.41"}',
 'Permanent Spinal Cord Stimulator Implantation','pain_management',
 '2025-02-01',1,'standard','pending',
 'SCS implantation for failed back surgery syndrome. Successful 7-day trial with 65% pain relief. Psych eval cleared. Failed multimodal conservative care over 22 months.',
 'Does the patient meet Cigna criteria for permanent SCS implantation?'),

-- David Thompson → BCBS Cervical Fusion
(1,'FAC-DEMO','REQ-1004','PAT-1004','BCBS','PROV-002','COV-1004',
 '22551','Anterior cervical discectomy and fusion (ACDF)','M50.121','{"M50.121","M54.12","G54.2"}',
 'C5-C6 Anterior Cervical Discectomy and Fusion','spine_surgery',
 '2025-02-15',1,'standard','pending',
 'C5-C6 ACDF for disc herniation with C6 radiculopathy confirmed by MRI and EMG. Failed 12 weeks PT, cervical ESI, and pharmacotherapy. Progressive grip weakness (3+/5). NDI 42%.',
 'Does the patient meet BCBS criteria for cervical spinal fusion?'),

-- Sarah Williams → Humana ESI
(1,'FAC-DEMO','REQ-1005','PAT-1005','HUMANA','PROV-003','COV-1005',
 '64483','Transforaminal epidural steroid injection','M54.41','{"M54.41","M51.16"}',
 'Right L5-S1 Transforaminal ESI','pain_management',
 '2025-02-01',1,'standard','pending',
 'First-time ESI for L5-S1 disc protrusion with S1 radiculopathy after failure of 10 weeks PT and medication trials (meloxicam, gabapentin).',
 'Does the patient meet Humana criteria for lumbar epidural steroid injection?')
ON CONFLICT (tenant_id, facility_id, request_id) DO NOTHING;

-- ============================================================
-- 11. PAYER POLICIES  (diverse across payers + service lines)
-- ============================================================

INSERT INTO demo.payer_policies (
  tenant_id, facility_id, policy_id, payer_id, policy_key,
  policy_name, service_category, cpt_codes,
  clinical_criteria, policy_text,
  required_documents, required_failed_therapies, min_therapy_weeks,
  guideline_source, appeal_deadline_days, effective_date
) VALUES
-- Aetna Lumbar Fusion
(1, 'FAC-DEMO', 'POL-AETNA-SPINE-001', 'AETNA', 'POL-AETNA-SPINE-001',
 'Aetna Lumbar Fusion Policy', 'spine_surgery',
 ARRAY['22612','22630','22633','63047','63048'],
 E'Lumbar fusion is medically necessary when ALL of the following are met:\n'
 '1. MRI or CT confirms disc herniation, stenosis, or spondylolisthesis with correlating symptoms;\n'
 '2. Patient has completed >= 12 weeks of structured physical therapy with documented functional outcome scores;\n'
 '3. At least 2 failed epidural steroid injections (ESI) or selective nerve root blocks;\n'
 '4. Documented failure of pharmacotherapy including NSAIDs, muscle relaxants, and neuropathic agents;\n'
 '5. Oswestry Disability Index (ODI) >= 40% or VAS pain score >= 7/10;\n'
 '6. BMI < 35 or documented medically-supervised weight management if BMI >= 35;\n'
 '7. No active tobacco use, or completion of cessation program.',
 E'Lumbar fusion is medically necessary when ALL of the following are met:\n'
 '1. MRI or CT confirms disc herniation, stenosis, or spondylolisthesis with correlating symptoms;\n'
 '2. Patient has completed >= 12 weeks of structured physical therapy with documented functional outcome scores;\n'
 '3. At least 2 failed epidural steroid injections (ESI) or selective nerve root blocks;\n'
 '4. Documented failure of pharmacotherapy including NSAIDs, muscle relaxants, and neuropathic agents;\n'
 '5. Oswestry Disability Index (ODI) >= 40% or VAS pain score >= 7/10;\n'
 '6. BMI < 35 or documented medically-supervised weight management if BMI >= 35;\n'
 '7. No active tobacco use, or completion of cessation program.',
 'MRI/CT report, PT records with functional scores, ESI procedure notes, medication log, ODI/VAS scores',
 3, 12, 'InterQual + Aetna CPB 0743', 45, '2024-01-01'),

-- Aetna TKA
(1, 'FAC-DEMO', 'POL-AETNA-TKA-001', 'AETNA', 'POL-AETNA-TKA-001',
 'Aetna Total Knee Arthroplasty Policy', 'orthopedic_surgery',
 ARRAY['27447','27446','27486','27487'],
 E'Total knee arthroplasty (TKA) is medically necessary when:\n'
 '1. Diagnosis of primary osteoarthritis (M17.x) or rheumatoid arthritis (M06.x) confirmed by weight-bearing radiographs;\n'
 '2. Kellgren-Lawrence grade 3 or 4 joint space narrowing;\n'
 '3. Patient has failed >= 6 months of conservative treatment including:\n'
 '   a. Physical therapy (minimum 12 visits)\n'
 '   b. NSAIDs or analgesics\n'
 '   c. At least 1 intra-articular corticosteroid or hyaluronic acid injection;\n'
 '4. Significant functional impairment documented by WOMAC or KOOS score;\n'
 '5. Age >= 50, or age < 50 with documented severe joint destruction;\n'
 '6. BMI < 40 or documented weight optimization if BMI >= 40.',
 E'Total knee arthroplasty (TKA) is medically necessary when:\n'
 '1. Diagnosis of primary osteoarthritis (M17.x) or rheumatoid arthritis (M06.x) confirmed by weight-bearing radiographs;\n'
 '2. Kellgren-Lawrence grade 3 or 4 joint space narrowing;\n'
 '3. Patient has failed >= 6 months of conservative treatment including:\n'
 '   a. Physical therapy (minimum 12 visits)\n'
 '   b. NSAIDs or analgesics\n'
 '   c. At least 1 intra-articular corticosteroid or hyaluronic acid injection;\n'
 '4. Significant functional impairment documented by WOMAC or KOOS score;\n'
 '5. Age >= 50, or age < 50 with documented severe joint destruction;\n'
 '6. BMI < 40 or documented weight optimization if BMI >= 40.',
 'Weight-bearing knee radiographs, PT records, injection records, WOMAC/KOOS scores',
 2, 26, 'Aetna CPB 0650', 45, '2024-01-01'),

-- Aetna ESI
(1, 'FAC-DEMO', 'POL-AETNA-ESI-001', 'AETNA', 'POL-AETNA-ESI-001',
 'Aetna Epidural Steroid Injection Policy', 'pain_management',
 ARRAY['62321','62322','62323','62324','62325','62326','62327','64483','64484'],
 E'Epidural steroid injection (ESI) requires prior authorization when:\n'
 '1. Clinical diagnosis of radiculopathy, spinal stenosis, or disc herniation confirmed by MRI;\n'
 '2. Patient has completed >= 6 weeks of conservative management (PT, oral medications);\n'
 '3. No more than 3 injections per spinal region per rolling 12-month period;\n'
 '4. Repeat injection requires >= 50% pain relief lasting >= 2 weeks from prior injection;\n'
 '5. Fluoroscopic or CT guidance is required;\n'
 '6. Contraindication screening: no active infection, no bleeding disorder, no allergy to injectate.',
 E'Epidural steroid injection (ESI) requires prior authorization when:\n'
 '1. Clinical diagnosis of radiculopathy, spinal stenosis, or disc herniation confirmed by MRI;\n'
 '2. Patient has completed >= 6 weeks of conservative management (PT, oral medications);\n'
 '3. No more than 3 injections per spinal region per rolling 12-month period;\n'
 '4. Repeat injection requires >= 50% pain relief lasting >= 2 weeks from prior injection;\n'
 '5. Fluoroscopic or CT guidance is required;\n'
 '6. Contraindication screening: no active infection, no bleeding disorder, no allergy to injectate.',
 'MRI report, prior injection records, PT records, medication history',
 1, 6, 'Aetna CPB 0016', 45, '2024-01-01'),

-- UHC Lumbar Fusion
(1, 'FAC-DEMO', 'POL-UHC-SPINE-001', 'UHC', 'POL-UHC-SPINE-001',
 'UHC Lumbar Fusion Medical Policy', 'spine_surgery',
 ARRAY['22612','22630','22633','22853','63047','63048'],
 E'UnitedHealthcare considers lumbar spinal fusion medically necessary when:\n'
 '1. Advanced imaging (MRI preferred) demonstrates structural pathology;\n'
 '2. At least 3 months of non-operative treatment including supervised PT;\n'
 '3. Progressive neurological deficit, or functionally disabling symptoms;\n'
 '4. Failure of at least one interventional pain procedure (ESI, nerve block, or facet injection);\n'
 '5. Patient is medically optimized for surgery (HbA1c < 8.0 if diabetic);\n'
 '6. Psychosocial screening completed (PHQ-9 or equivalent);\n'
 '7. Surgical plan includes no more than 3 motion segments.',
 E'UnitedHealthcare considers lumbar spinal fusion medically necessary when:\n'
 '1. Advanced imaging (MRI preferred) demonstrates structural pathology;\n'
 '2. At least 3 months of non-operative treatment including supervised PT;\n'
 '3. Progressive neurological deficit, or functionally disabling symptoms;\n'
 '4. Failure of at least one interventional pain procedure (ESI, nerve block, or facet injection);\n'
 '5. Patient is medically optimized for surgery (HbA1c < 8.0 if diabetic);\n'
 '6. Psychosocial screening completed (PHQ-9 or equivalent);\n'
 '7. Surgical plan includes no more than 3 motion segments.',
 'MRI report, PT records, interventional procedure notes, HbA1c labs, PHQ-9 screening',
 2, 12, 'UHC Medical Policy 2023T0547 + MCG', 60, '2024-01-01'),

-- UHC TKA
(1, 'FAC-DEMO', 'POL-UHC-TKA-001', 'UHC', 'POL-UHC-TKA-001',
 'UHC Total Knee Replacement Policy', 'orthopedic_surgery',
 ARRAY['27447','27446'],
 E'Total knee arthroplasty is covered when ALL criteria are met:\n'
 '1. Radiographic evidence of Kellgren-Lawrence grade >= 3;\n'
 '2. Failure of >= 3 months conservative care including PT and activity modification;\n'
 '3. Trial of at least 2 pharmacologic agents (NSAIDs, acetaminophen, topical agents);\n'
 '4. At least 1 corticosteroid or viscosupplementation injection;\n'
 '5. Functional assessment showing ADL limitations (WOMAC total score >= 50);\n'
 '6. BMI < 40 or documented weight management referral;\n'
 '7. Pre-operative medical clearance including cardiac risk assessment.',
 E'Total knee arthroplasty is covered when ALL criteria are met:\n'
 '1. Radiographic evidence of Kellgren-Lawrence grade >= 3;\n'
 '2. Failure of >= 3 months conservative care including PT and activity modification;\n'
 '3. Trial of at least 2 pharmacologic agents (NSAIDs, acetaminophen, topical agents);\n'
 '4. At least 1 corticosteroid or viscosupplementation injection;\n'
 '5. Functional assessment showing ADL limitations (WOMAC total score >= 50);\n'
 '6. BMI < 40 or documented weight management referral;\n'
 '7. Pre-operative medical clearance including cardiac risk assessment.',
 'Weight-bearing radiographs, PT records, injection records, WOMAC scores, medical clearance',
 2, 12, 'UHC Medical Policy 2023T0234', 60, '2024-01-01'),

-- UHC ESI
(1, 'FAC-DEMO', 'POL-UHC-ESI-001', 'UHC', 'POL-UHC-ESI-001',
 'UHC Epidural Steroid Injection Policy', 'pain_management',
 ARRAY['62321','62322','62323','62324','64483','64484'],
 E'UHC considers epidural steroid injection medically necessary when:\n'
 '1. Radiculopathy or spinal stenosis documented by clinical exam and confirmed by MRI/CT;\n'
 '2. Minimum 4 weeks of conservative treatment (PT, medications);\n'
 '3. Limit of 3 ESI per region per 12-month rolling period;\n'
 '4. For repeat ESI: documented >= 50% improvement from prior injection;\n'
 '5. Fluoroscopic guidance required for all spinal injections;\n'
 '6. No contraindications (active infection, anticoagulation, pregnancy).',
 E'UHC considers epidural steroid injection medically necessary when:\n'
 '1. Radiculopathy or spinal stenosis documented by clinical exam and confirmed by MRI/CT;\n'
 '2. Minimum 4 weeks of conservative treatment (PT, medications);\n'
 '3. Limit of 3 ESI per region per 12-month rolling period;\n'
 '4. For repeat ESI: documented >= 50% improvement from prior injection;\n'
 '5. Fluoroscopic guidance required for all spinal injections;\n'
 '6. No contraindications (active infection, anticoagulation, pregnancy).',
 'MRI/CT report, PT records, prior injection records if applicable',
 1, 4, 'UHC Medical Policy + MCG', 60, '2024-01-01'),

-- Cigna Spine Fusion
(1, 'FAC-DEMO', 'POL-CIGNA-SPINE-001', 'CIGNA', 'POL-CIGNA-SPINE-001',
 'Cigna Spinal Fusion Surgery Policy', 'spine_surgery',
 ARRAY['22612','22630','22633','22551','63047','63048','63020'],
 E'Cigna considers spinal fusion surgery medically necessary when:\n'
 '1. Structural instability or deformity confirmed by dynamic flexion/extension radiographs or advanced imaging;\n'
 '2. Minimum 8 weeks of documented conservative treatment failure;\n'
 '3. Documented failure of at least one image-guided interventional procedure;\n'
 '4. Validated pain or disability instrument (ODI, NDI, or VAS) showing >= moderate impairment;\n'
 '5. Independent medical review may be required for revision surgery;\n'
 '6. Multi-level fusion (> 2 levels) requires peer-to-peer review.',
 E'Cigna considers spinal fusion surgery medically necessary when:\n'
 '1. Structural instability or deformity confirmed by dynamic flexion/extension radiographs or advanced imaging;\n'
 '2. Minimum 8 weeks of documented conservative treatment failure;\n'
 '3. Documented failure of at least one image-guided interventional procedure;\n'
 '4. Validated pain or disability instrument (ODI, NDI, or VAS) showing >= moderate impairment;\n'
 '5. Independent medical review may be required for revision surgery;\n'
 '6. Multi-level fusion (> 2 levels) requires peer-to-peer review.',
 'Imaging studies, PT records, procedure notes, ODI/NDI/VAS scores',
 2, 8, 'Cigna Medical Coverage Policy 0088', 60, '2024-01-01'),

-- Cigna SCS
(1, 'FAC-DEMO', 'POL-CIGNA-SCS-001', 'CIGNA', 'POL-CIGNA-SCS-001',
 'Cigna Spinal Cord Stimulator Policy', 'pain_management',
 ARRAY['63650','63655','63661','63662','63663','63664','63685','63688'],
 E'Spinal cord stimulator (SCS) implantation requires prior authorization:\n'
 '1. Diagnosis of chronic intractable pain (failed back surgery syndrome, CRPS, or neuropathy);\n'
 '2. Pain duration >= 6 months with documented failure of multimodal conservative care;\n'
 '3. Psychological evaluation completed within 12 months confirming no untreated psychiatric contraindication;\n'
 '4. Successful SCS trial period (>= 50% pain relief during 5-7 day trial);\n'
 '5. No active substance abuse disorder or completion of treatment program;\n'
 '6. Patient is not a candidate for further corrective surgery;\n'
 '7. Follow-up plan documented including device management and PT.',
 E'Spinal cord stimulator (SCS) implantation requires prior authorization:\n'
 '1. Diagnosis of chronic intractable pain (failed back surgery syndrome, CRPS, or neuropathy);\n'
 '2. Pain duration >= 6 months with documented failure of multimodal conservative care;\n'
 '3. Psychological evaluation completed within 12 months confirming no untreated psychiatric contraindication;\n'
 '4. Successful SCS trial period (>= 50% pain relief during 5-7 day trial);\n'
 '5. No active substance abuse disorder or completion of treatment program;\n'
 '6. Patient is not a candidate for further corrective surgery;\n'
 '7. Follow-up plan documented including device management and PT.',
 'Psych eval, SCS trial results, PT records, medication history, imaging studies',
 3, 26, 'Cigna Medical Coverage Policy 0112', 60, '2024-01-01'),

-- Humana Spine
(1, 'FAC-DEMO', 'POL-HUMANA-SPINE-001', 'HUMANA', 'POL-HUMANA-SPINE-001',
 'Humana Lumbar Spinal Fusion Medical Policy', 'spine_surgery',
 ARRAY['22612','22630','22633','63047','63048'],
 E'Humana authorizes lumbar spinal fusion when:\n'
 '1. Confirmed diagnosis with MRI showing disc herniation, spinal stenosis, or degenerative spondylolisthesis;\n'
 '2. Minimum 6 weeks of supervised physical therapy with documented progress notes;\n'
 '3. Trial of at least 2 classes of oral medications;\n'
 '4. At least 1 fluoroscopy-guided injection procedure attempted;\n'
 '5. Functional assessment (ODI or SF-36) within 30 days of surgery request;\n'
 '6. Surgical plan reviewed by Humana medical director for multi-level procedures.',
 E'Humana authorizes lumbar spinal fusion when:\n'
 '1. Confirmed diagnosis with MRI showing disc herniation, spinal stenosis, or degenerative spondylolisthesis;\n'
 '2. Minimum 6 weeks of supervised physical therapy with documented progress notes;\n'
 '3. Trial of at least 2 classes of oral medications;\n'
 '4. At least 1 fluoroscopy-guided injection procedure attempted;\n'
 '5. Functional assessment (ODI or SF-36) within 30 days of surgery request;\n'
 '6. Surgical plan reviewed by Humana medical director for multi-level procedures.',
 'MRI report, PT notes, medication list, injection records, ODI/SF-36',
 2, 6, 'Humana Medical Coverage Policy', 45, '2024-01-01'),

-- Humana ESI
(1, 'FAC-DEMO', 'POL-HUMANA-ESI-001', 'HUMANA', 'POL-HUMANA-ESI-001',
 'Humana Epidural Steroid Injection Policy', 'pain_management',
 ARRAY['62321','62322','62323','64483','64484'],
 E'Humana considers ESI medically necessary when:\n'
 '1. Documented radiculopathy or spinal stenosis with MRI correlation;\n'
 '2. At least 6 weeks of conservative management including PT and oral analgesics;\n'
 '3. Maximum 3 injections per spinal region per 12 months;\n'
 '4. Image guidance (fluoroscopy or CT) required;\n'
 '5. For repeat injection: prior injection documented >= 50% relief for >= 2 weeks.',
 E'Humana considers ESI medically necessary when:\n'
 '1. Documented radiculopathy or spinal stenosis with MRI correlation;\n'
 '2. At least 6 weeks of conservative management including PT and oral analgesics;\n'
 '3. Maximum 3 injections per spinal region per 12 months;\n'
 '4. Image guidance (fluoroscopy or CT) required;\n'
 '5. For repeat injection: prior injection documented >= 50% relief for >= 2 weeks.',
 'MRI report, PT records, medication history',
 1, 6, 'Humana Medical Coverage Policy', 45, '2024-01-01')
ON CONFLICT (tenant_id, facility_id, policy_id) DO NOTHING;

-- ============================================================
-- 12. LETTER TEMPLATES  (multiple service lines)
-- ============================================================

INSERT INTO demo.letter_templates (
  tenant_id, facility_id, template_id, template_key,
  template_name, letter_type, service_category,
  template_body, template_text,
  instructions, placeholders, version, is_active
) VALUES
-- Ortho (Joint Replacement) Template
(1, 'FAC-DEMO', 'TMPL-IA-ORTHO-001', 'TMPL-IA-ORTHO-001',
 'Initial Auth - Orthopedic Surgery (Joint Replacement)',
 'initial_auth', 'orthopedic_surgery',
 E'[Date]\n\n[Payer Name]\n[Payer Address]\n\n'
 'RE: Prior Authorization Request - Total Joint Arthroplasty\n'
 'Patient: [Patient Name]    DOB: [DOB]    Member ID: [Member ID]\n'
 'Group: [Group ID]    Plan: [Plan Name]\n\n'
 'Dear Medical Director,\n\n'
 'I am writing to request prior authorization for total joint arthroplasty (CPT [CPT Codes]) for the above-referenced patient. '
 'As the treating orthopedic surgeon, I have determined this procedure to be medically necessary based on the following clinical evidence.\n\n'
 '## Clinical History\n[Patient clinical history, diagnosis, symptom duration, functional impact]\n\n'
 '## Radiographic Findings\n[Imaging results including Kellgren-Lawrence grading, joint space narrowing, osteophytes]\n\n'
 '## Conservative Treatment History\n[Physical therapy details, medication trials, injection history with outcomes]\n\n'
 '## Functional Assessment\n[WOMAC/KOOS scores, ADL limitations, gait assessment]\n\n'
 '## Medical Necessity\n[Alignment with payer policy criteria, point-by-point justification]\n\n'
 '## Conclusion\nBased on the clinical evidence presented, total joint arthroplasty is the appropriate next step in treatment.\n\n'
 'Sincerely,\n[Provider Signature]\n[Provider Name], [Credentials]\nNPI: [Provider NPI]\n[Facility Name]',
 E'[Date]\n\n[Payer Name]\n[Payer Address]\n\n'
 'RE: Prior Authorization Request - Total Joint Arthroplasty\n'
 'Patient: [Patient Name]    DOB: [DOB]    Member ID: [Member ID]\n'
 'Group: [Group ID]    Plan: [Plan Name]\n\n'
 'Dear Medical Director,\n\n'
 'I am writing to request prior authorization for total joint arthroplasty (CPT [CPT Codes]) for the above-referenced patient. '
 'As the treating orthopedic surgeon, I have determined this procedure to be medically necessary based on the following clinical evidence.\n\n'
 '## Clinical History\n[Patient clinical history, diagnosis, symptom duration, functional impact]\n\n'
 '## Radiographic Findings\n[Imaging results including Kellgren-Lawrence grading, joint space narrowing, osteophytes]\n\n'
 '## Conservative Treatment History\n[Physical therapy details, medication trials, injection history with outcomes]\n\n'
 '## Functional Assessment\n[WOMAC/KOOS scores, ADL limitations, gait assessment]\n\n'
 '## Medical Necessity\n[Alignment with payer policy criteria, point-by-point justification]\n\n'
 '## Conclusion\nBased on the clinical evidence presented, total joint arthroplasty is the appropriate next step in treatment.\n\n'
 'Sincerely,\n[Provider Signature]\n[Provider Name], [Credentials]\nNPI: [Provider NPI]\n[Facility Name]',
 'Generate a prior authorization letter for total joint arthroplasty. Include radiographic grading (Kellgren-Lawrence), functional scores (WOMAC/KOOS), and align each policy criterion with patient evidence.',
 '{"sections":["header","introduction","clinical_history","radiographic_findings","conservative_treatment","functional_assessment","medical_necessity","conclusion"]}',
 1, true),

-- Pain Management (ESI/Injection) Template
(1, 'FAC-DEMO', 'TMPL-IA-PAIN-001', 'TMPL-IA-PAIN-001',
 'Initial Auth - Interventional Pain Management',
 'initial_auth', 'pain_management',
 E'[Date]\n\n[Payer Name]\n[Payer Address]\n\n'
 'RE: Prior Authorization Request - Interventional Pain Procedure\n'
 'Patient: [Patient Name]    DOB: [DOB]    Member ID: [Member ID]\n\n'
 'Dear Utilization Review Department,\n\n'
 'I am requesting prior authorization for [Procedure Name] (CPT [CPT Codes]) for the above-referenced patient '
 'who has been under my care for management of [Diagnosis].\n\n'
 '## Diagnosis & Clinical Presentation\n[Primary and secondary diagnoses with ICD-10 codes, symptom description, neurological exam findings]\n\n'
 '## Diagnostic Imaging\n[MRI/CT findings, correlation with clinical presentation]\n\n'
 '## Prior Conservative Treatment\n[Medication trials, PT visits, prior injection procedures with outcomes]\n\n'
 '## Medical Necessity Justification\n[Why this procedure is needed, alignment with clinical guidelines]\n\n'
 '## Procedure Plan\n[Specific procedure, approach, image guidance, number of levels]\n\n'
 'Thank you for your prompt review.\n\nSincerely,\n[Provider Signature]\n[Provider Name], [Credentials]\n[Facility Name]',
 E'[Date]\n\n[Payer Name]\n[Payer Address]\n\n'
 'RE: Prior Authorization Request - Interventional Pain Procedure\n'
 'Patient: [Patient Name]    DOB: [DOB]    Member ID: [Member ID]\n\n'
 'Dear Utilization Review Department,\n\n'
 'I am requesting prior authorization for [Procedure Name] (CPT [CPT Codes]) for the above-referenced patient '
 'who has been under my care for management of [Diagnosis].\n\n'
 '## Diagnosis & Clinical Presentation\n[Primary and secondary diagnoses with ICD-10 codes, symptom description, neurological exam findings]\n\n'
 '## Diagnostic Imaging\n[MRI/CT findings, correlation with clinical presentation]\n\n'
 '## Prior Conservative Treatment\n[Medication trials, PT visits, prior injection procedures with outcomes]\n\n'
 '## Medical Necessity Justification\n[Why this procedure is needed, alignment with clinical guidelines]\n\n'
 '## Procedure Plan\n[Specific procedure, approach, image guidance, number of levels]\n\n'
 'Thank you for your prompt review.\n\nSincerely,\n[Provider Signature]\n[Provider Name], [Credentials]\n[Facility Name]',
 'Generate a prior authorization letter for an interventional pain procedure. Include imaging findings, prior injection response data, and medication trial outcomes. Address each payer criterion individually.',
 '{"sections":["header","introduction","diagnosis","imaging","conservative_treatment","medical_necessity","procedure_plan","conclusion"]}',
 1, true),

-- SCS Template
(1, 'FAC-DEMO', 'TMPL-IA-SCS-001', 'TMPL-IA-SCS-001',
 'Initial Auth - Spinal Cord Stimulator',
 'initial_auth', 'pain_management',
 E'[Date]\n\n[Payer Name]\n[Payer Address]\n\n'
 'RE: Prior Authorization Request - Spinal Cord Stimulator Implantation\n'
 'Patient: [Patient Name]    DOB: [DOB]    Member ID: [Member ID]\n\n'
 'Dear Medical Director,\n\n'
 'I am requesting prior authorization for spinal cord stimulator implantation (CPT [CPT Codes]) '
 'for [Patient Name], diagnosed with chronic intractable pain secondary to [Diagnosis].\n\n'
 '## Chronic Pain History\n[Pain duration, etiology, prior surgical history, FBSS details]\n\n'
 '## Multimodal Treatment History\n[All treatments: PT, medications, injections, nerve blocks, behavioral therapy with dates and outcomes]\n\n'
 '## Psychological Evaluation\n[Evaluator, date, findings, recommendation, no psychiatric contraindications]\n\n'
 '## SCS Trial Results\n[Trial dates, device type, lead placement, percent pain relief, functional improvement]\n\n'
 '## Medical Necessity\n[Why permanent implantation is warranted, alignment with policy criteria]\n\n'
 'Sincerely,\n[Provider Signature]\n[Provider Name], [Credentials]\n[Facility Name]',
 E'[Date]\n\n[Payer Name]\n[Payer Address]\n\n'
 'RE: Prior Authorization Request - Spinal Cord Stimulator Implantation\n'
 'Patient: [Patient Name]    DOB: [DOB]    Member ID: [Member ID]\n\n'
 'Dear Medical Director,\n\n'
 'I am requesting prior authorization for spinal cord stimulator implantation (CPT [CPT Codes]) '
 'for [Patient Name], diagnosed with chronic intractable pain secondary to [Diagnosis].\n\n'
 '## Chronic Pain History\n[Pain duration, etiology, prior surgical history, FBSS details]\n\n'
 '## Multimodal Treatment History\n[All treatments: PT, medications, injections, nerve blocks, behavioral therapy with dates and outcomes]\n\n'
 '## Psychological Evaluation\n[Evaluator, date, findings, recommendation, no psychiatric contraindications]\n\n'
 '## SCS Trial Results\n[Trial dates, device type, lead placement, percent pain relief, functional improvement]\n\n'
 '## Medical Necessity\n[Why permanent implantation is warranted, alignment with policy criteria]\n\n'
 'Sincerely,\n[Provider Signature]\n[Provider Name], [Credentials]\n[Facility Name]',
 'Generate a prior authorization letter for SCS implantation. Must include psychological evaluation results, SCS trial outcomes (>= 50% relief), and comprehensive multimodal treatment failure documentation.',
 '{"sections":["header","introduction","chronic_pain_history","treatment_history","psych_eval","scs_trial","medical_necessity","conclusion"]}',
 1, true)
ON CONFLICT (tenant_id, facility_id, template_id) DO NOTHING;

-- ============================================================
-- 13. TEMPLATE SECTIONS FOR ORTHO TEMPLATE
-- ============================================================

INSERT INTO demo.template_sections (
  tenant_id, facility_id, section_id, template_id,
  section_name, section_order, instruction_prompt, scaffold_text,
  requires_policy, requires_clinical
) VALUES
(1,'FAC-DEMO','SEC-ORTHO-001','TMPL-IA-ORTHO-001','header',1,
 'Generate the letterhead with today''s date, facility info, payer address, and RE: line with patient identifiers.','',false,false),
(1,'FAC-DEMO','SEC-ORTHO-002','TMPL-IA-ORTHO-001','introduction',2,
 'Introduce the requesting provider, specialty, and the specific surgical procedure being requested with CPT codes.','',false,false),
(1,'FAC-DEMO','SEC-ORTHO-003','TMPL-IA-ORTHO-001','clinical_history',3,
 'Present the patient''s clinical history including primary diagnosis, onset, duration, and functional impact on daily activities.','',false,true),
(1,'FAC-DEMO','SEC-ORTHO-004','TMPL-IA-ORTHO-001','radiographic_findings',4,
 'Detail radiographic findings including Kellgren-Lawrence grade, joint space narrowing, osteophyte formation, and subchondral changes.','',false,true),
(1,'FAC-DEMO','SEC-ORTHO-005','TMPL-IA-ORTHO-001','conservative_treatment',5,
 'Document all conservative treatments: PT visits and outcomes, medication trials (name, dose, duration, result), injection history.','',false,true),
(1,'FAC-DEMO','SEC-ORTHO-006','TMPL-IA-ORTHO-001','medical_necessity',6,
 'Align the patient''s clinical evidence with each payer policy criterion. Address each criterion individually with supporting evidence.','',true,true),
(1,'FAC-DEMO','SEC-ORTHO-007','TMPL-IA-ORTHO-001','conclusion',7,
 'Summarize the clinical case, restate the request, and provide contact information.','',false,false)
ON CONFLICT (tenant_id, facility_id, section_id) DO NOTHING;

COMMIT;
