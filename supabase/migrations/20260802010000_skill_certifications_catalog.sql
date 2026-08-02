-- Curated skill -> real-world certification mapping for the skill-gap-path
-- feature. Deliberately NOT AI-generated at lookup time — a model asked to
-- name a certification for an arbitrary skill string can hallucinate one
-- that doesn't exist (wrong provider, wrong name, discontinued cert), and
-- this is advice that feeds into someone's actual career decisions. Every
-- row here should be a real, currently-offered certification, verified
-- before adding. Skills with no entry simply show no certification
-- suggestion — silence is safer than a guess.
CREATE TABLE IF NOT EXISTS skill_certifications_catalog (
  skill_slug TEXT PRIMARY KEY,
  skill_display TEXT NOT NULL,
  certifications JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO skill_certifications_catalog (skill_slug, skill_display, certifications) VALUES
('kubernetes', 'Kubernetes', '[
  {"name": "Certified Kubernetes Administrator (CKA)", "provider": "Linux Foundation / CNCF", "url": "https://training.linuxfoundation.org/certification/certified-kubernetes-administrator-cka/"},
  {"name": "Certified Kubernetes Application Developer (CKAD)", "provider": "Linux Foundation / CNCF", "url": "https://training.linuxfoundation.org/certification/certified-kubernetes-application-developer-ckad/"}
]'),
('aws', 'AWS', '[
  {"name": "AWS Certified Solutions Architect – Associate", "provider": "Amazon Web Services", "url": "https://aws.amazon.com/certification/certified-solutions-architect-associate/"},
  {"name": "AWS Certified Developer – Associate", "provider": "Amazon Web Services", "url": "https://aws.amazon.com/certification/certified-developer-associate/"}
]'),
('azure', 'Azure', '[
  {"name": "Microsoft Certified: Azure Fundamentals (AZ-900)", "provider": "Microsoft", "url": "https://learn.microsoft.com/en-us/credentials/certifications/azure-fundamentals/"},
  {"name": "Microsoft Certified: Azure Administrator Associate (AZ-104)", "provider": "Microsoft", "url": "https://learn.microsoft.com/en-us/credentials/certifications/azure-administrator/"}
]'),
('gcp', 'Google Cloud', '[
  {"name": "Google Cloud Associate Cloud Engineer", "provider": "Google Cloud", "url": "https://cloud.google.com/certification/cloud-engineer"},
  {"name": "Google Cloud Professional Cloud Architect", "provider": "Google Cloud", "url": "https://cloud.google.com/certification/cloud-architect"}
]'),
('google cloud', 'Google Cloud', '[
  {"name": "Google Cloud Associate Cloud Engineer", "provider": "Google Cloud", "url": "https://cloud.google.com/certification/cloud-engineer"},
  {"name": "Google Cloud Professional Cloud Architect", "provider": "Google Cloud", "url": "https://cloud.google.com/certification/cloud-architect"}
]'),
('docker', 'Docker', '[
  {"name": "Docker Certified Associate (DCA)", "provider": "Mirantis", "url": "https://training.mirantis.com/certification/dca-certification-exam/"}
]'),
('terraform', 'Terraform', '[
  {"name": "HashiCorp Certified: Terraform Associate", "provider": "HashiCorp", "url": "https://www.hashicorp.com/certification/terraform-associate"}
]'),
('python', 'Python', '[
  {"name": "PCEP – Certified Entry-Level Python Programmer", "provider": "Python Institute", "url": "https://pythoninstitute.org/pcep"},
  {"name": "PCAP – Certified Associate in Python Programming", "provider": "Python Institute", "url": "https://pythoninstitute.org/pcap"}
]'),
('java', 'Java', '[
  {"name": "Oracle Certified Professional: Java SE Programmer", "provider": "Oracle", "url": "https://education.oracle.com/java-se-11-developer/pexam_1Z0-819"}
]'),
('sql', 'SQL', '[
  {"name": "Oracle Database SQL Certified Associate", "provider": "Oracle", "url": "https://education.oracle.com/oracle-database-sql-certified-associate/pexam_1Z0-071"}
]'),
('security', 'Security', '[
  {"name": "CISSP – Certified Information Systems Security Professional", "provider": "ISC2", "url": "https://www.isc2.org/certifications/cissp"},
  {"name": "CompTIA Security+", "provider": "CompTIA", "url": "https://www.comptia.org/certifications/security"}
]'),
('scrum', 'Scrum / Agile', '[
  {"name": "Certified ScrumMaster (CSM)", "provider": "Scrum Alliance", "url": "https://www.scrumalliance.org/get-certified/scrum-master-track/certified-scrummaster"},
  {"name": "PMI Agile Certified Practitioner (PMI-ACP)", "provider": "Project Management Institute", "url": "https://www.pmi.org/certifications/agile-acp"}
]'),
('project management', 'Project Management', '[
  {"name": "Project Management Professional (PMP)", "provider": "Project Management Institute", "url": "https://www.pmi.org/certifications/project-management-pmp"},
  {"name": "Certified Associate in Project Management (CAPM)", "provider": "Project Management Institute", "url": "https://www.pmi.org/certifications/associate-capm"}
]'),
('salesforce', 'Salesforce', '[
  {"name": "Salesforce Certified Administrator", "provider": "Salesforce", "url": "https://trailhead.salesforce.com/credentials/administrator"}
]'),
('google analytics', 'Google Analytics', '[
  {"name": "Google Analytics Certification", "provider": "Google (Skillshop)", "url": "https://skillshop.withgoogle.com/"}
]'),
('google ads', 'Google Ads / SEM', '[
  {"name": "Google Ads Certification", "provider": "Google (Skillshop)", "url": "https://skillshop.withgoogle.com/"}
]'),
('data analysis', 'Data Analysis', '[
  {"name": "Google Data Analytics Professional Certificate", "provider": "Google / Coursera", "url": "https://grow.google/certificates/data-analytics/"}
]'),
('tensorflow', 'TensorFlow / ML', '[
  {"name": "TensorFlow Developer Certificate", "provider": "Google", "url": "https://www.tensorflow.org/certificate"}
]'),
('excel', 'Excel', '[
  {"name": "Microsoft Office Specialist: Excel Expert", "provider": "Microsoft", "url": "https://learn.microsoft.com/en-us/credentials/certifications/office-excel-expert/"}
]')
ON CONFLICT (skill_slug) DO NOTHING;
