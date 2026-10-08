// Real titles (taken from the live feed) per family: `yes` must match, `no` must not. Shared by the unit
// and the Postgres tests so a pattern change that breaks a known case fails in both.
export const CORPUS = {
  engineering: {
    yes: ['Senior Software Engineer', 'Staff Software Engineer, Platform', 'Full-Stack Developer', 'Fullstack Engineer', 'Backend Engineer (Node.js/Typescript)',
      'Senior Android Engineer - Kotlin (m/f/d)', 'Site Reliability Engineer (SRE)', 'DevOps Engineer', 'Data Engineer', 'Machine Learning Engineer', 'Platform Engineer',
      'Software Development Engineer II', 'Mobile Developer (React Native)', 'Shopify Developer', 'QA Automation Engineer', 'Director of Engineering', 'Forward Deployed Engineer',
      'Senior iOS Engineer', 'Software Engineer, Backend (All Levels)', 'Lead .NET Full Stack Engineer', 'Founding Engineer ($3M pre-seed)'],
    no: ['Sales Engineer', 'Solutions Engineer', 'Field Service Engineer', 'Mechanical Engineer', 'Electrical Engineer', 'Civil Engineer', 'Process Engineer', 'Quality Engineer',
      'Manufacturing Engineer', 'HVAC & Utilities Engineer/Supervisor (Industrial HVAC Systems)', 'Senior Technical Support Engineer', 'Engineer', 'Project Engineer',
      'Business Developer België', 'Real Estate Developer', 'Developer Advocate', 'Developer Relations Manager', 'Senior Geotechnical Engineer', 'Staff Mechanical Engineer',
      'Systems Engineer', 'Customer Success Engineer (Americas)', 'Hardware Engineer', 'Mechanical Engineering Intern'],
  },
  'data-ml': {
    yes: ['Senior Data Scientist', 'Data Analyst', 'Machine Learning Engineer', 'Analytics Engineer', 'Staff Applied Scientist - Knowledge Graphs & AI', 'Senior AI Engineer',
      'Senior Business Intelligence Analyst, Marketing', 'Research Scientist - NLP', 'MLOps Enginneer L2'],
    no: ['Work at home Data Entry Clerk - Part Time', 'Data Center Technician Supervisor', 'Medical Scientist - Histology - Dublin', 'Process Engineer/Scientist, Crystalization/Separation',
      'Solutions Engineer', 'Mechanical Engineer', 'Registered Nurse'],
  },
  product: {
    yes: ['Senior Product Manager', 'Head of Product', 'Product Owner', 'Group Product Manager', 'Technical Product Manager - Money and Risk', 'Vice President, Product Management'],
    no: ['Product Marketing Manager', 'Production Manager', 'Product Designer', 'Product Support Specialist', 'Senior Product Operations Manager', 'Director of Product Marketing'],
  },
  design: {
    yes: ['Senior Product Designer', 'UX/UI Designer I', 'Graphic Designer', 'Creative Director - AntiSocial', 'Motion Graphic Designer', 'Art Director', 'UX Researcher'],
    no: ['Mechanical Design Engineer', 'Interior Designer II - Hospitality & Gaming', 'Electrical Designer', 'Head of Hardware Product Design - San Francisco', 'Senior UI/UX Engineer- Quantum Computing',
      'CAD Designer - Land Development', 'Assistant Design Manager (Construction)'],
  },
  sales: {
    yes: ['Enterprise Account Executive', 'Sales Development Representative', 'Business Development Manager (Kuwait)', 'Solutions Engineer', 'Territory Manager (South East, Oklahoma)',
      'Regional Sales Director', 'Head of Business Development / Sales Grands Comptes'],
    no: ['Seasonal Sales Associate', 'Sales Associate', 'Software Engineer, Sales Platform', 'Retail Sales Merchandiser', 'Salesforce Developer', 'Accounts Payable Specialist'],
  },
  marketing: {
    yes: ['Marketing Manager', 'Product Marketing Manager', 'Social Media Manager - Instagram', 'Email Marketing Specialist', 'Copywriter', 'SEO Specialist', 'Chief Marketing Officer'],
    no: ['Software Engineer, Marketing Platform', 'Marketing Data Scientist', 'Marketplace Operations Specialist'],
  },
  customer: {
    yes: ['Customer Success Manager', 'Customer Support Representative', 'Technical Support Engineer (French-speaking)', 'Customer Service Representative', 'Help Desk Technician', 'Technical Account Manager'],
    no: ['Sales Support Specialist - AI Trainer', 'Administrative Support Worker', 'Software Engineer, Customer Support Platform'],
  },
  operations: {
    yes: ['Operations Manager', 'Supply Chain Analyst', 'Logistics Coordinator', 'Procurement Manager', 'Demand Planner', 'Inventory Analyst'],
    no: ['Senior Security Operations Engineer', 'Operations Associate, Starbucks Barista, Washington D.C, #206', 'Marketing Operations Manager', 'Senior DevOps Engineer - Cloud Operations'],
  },
  finance: {
    yes: ['Senior Accountant', 'Financial Analyst', 'Controller', 'FP&A Manager', 'Tax Manager', 'Payroll Clerk', 'Internal Auditor'],
    no: ['Launch Engineer - Vehicle Controller', 'Quality Auditor (Spain)', 'Night-Auditor (m/w/d) - Rezeption', 'Software Engineer, Finance Systems'],
  },
  hr: {
    yes: ['Technical Recruiter', 'HR Business Partner', 'Talent Acquisition Specialist', 'People Operations Manager', 'Human Resources Generalist', 'Senior Sourcer', 'Head of People'],
    no: ['Work From Home - Client Benefits Specialist', 'Certified Home Care Home Health Aide 4-12hr Day Shift', 'Senior Manager, Trial Awareness & Recruitment', 'Software Engineer, Recruiting Platform'],
  },
  healthcare: {
    yes: ['Registered Nurse (RN)', 'Physical Therapist', 'Medical Assistant (CMA)', 'Home Health Aide', 'Nurse Practitioner', 'PRN Licensed Dental Hygienist', 'Fulfillment Pharmacy Technician'],
    no: ['Clinical Research Associate', 'Medical Sales - Remote', 'Healthcare Software Engineer', 'Medical Science Liaison', 'Assay Lab Technician', 'Account Executive (US - Independent Pharmacies)'],
  },
  education: {
    yes: ['Math Teacher - Signing Bonus Eligible', 'Special Education Teacher', 'Substitute Teacher', 'Full Professor/Associate/Assistant Professor of Physics', 'GED Tutor', 'Senior Instructional Designer'],
    no: ['Group Fitness Instructor', 'Yoga Instructor (Contractor)', 'Construction Superintendent', 'Customer Education Specialist | Housing', 'Principal Software Engineer', 'University Recruiter'],
  },
  legal: {
    yes: ['Paralegal', 'Senior Counsel', 'Litigation Attorney', 'Associate General Counsel - Life Sciences', 'Legal Assistant', 'Hindi Document Review Attorney'],
    no: ['Law Enforcement Officer', 'Legal Recruiter', 'Licensed Professional Counselor (LPC) - Remote', 'Legal Engineer', 'Marketing Lead - Legal Solutions'],
  },
  frontline: {
    yes: ['Cashier', 'Cafe Barista', 'Line Cook', 'Store Manager', 'Hotel Front Desk Agent', 'Housekeeper', 'Shift Leader', 'Seasonal Sales Associate'],
    no: ['SQL Server Engineer', 'Retail Software Engineer', 'Cook County Assessor', 'Sales Development Representative / FX Sales Associate (m/w/d)'],
  },
};
