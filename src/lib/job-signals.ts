const CAMPUS_RECRUITMENT_SIGNAL =
  /校园招聘|校园招募|校招|秋招|应届生(?:校园)?招聘|graduate\s+(?:program|programme|recruitment)/i;

const INTERN_PROCESS_SIGNAL =
  /(?:先|须|需|需要|要求|安排|经过|进行|进入|参与|完成|接受|为期|不少于|至少|录用后)[^。；;\n]{0,20}实习|实习(?:考察|考核|培养|实践)?(?:期|阶段)|实习转正|实习留用/i;

const CONVERSION_SIGNAL = /转正|留用|正式录用|正式入职/i;

const EXPLICIT_INTERN_ASSESSMENT_SIGNAL =
  /实习(?:考察|考核|培养|实践)(?:期|阶段)?|实习(?:考察|考核|培养|实践)?(?:期|阶段)/i;

const INTERN_POSITION_SIGNAL =
  /实习生|日常实习|暑期实习|实习岗位|岗位性质\s*[：:]?\s*实习|招聘(?:类别|类型)\s*[：:]?\s*实习|intern(?:ship)?\b|实习(?:岗|岗位)?$/im;

/**
 * 识别“明确校招，但正式录用前需要先经过实习考察”的岗位。
 * 纯实习、实习经历优先和普通试用期转正不属于该类。
 */
export function hasInternAssessmentRequirement(text: string): boolean {
  if (!CAMPUS_RECRUITMENT_SIGNAL.test(text)) return false;

  return text
    .split(/[。；;\n]/)
    .some((segment) => {
      if (/实习经历|实习经验/i.test(segment)) return false;
      return EXPLICIT_INTERN_ASSESSMENT_SIGNAL.test(segment)
        || INTERN_PROCESS_SIGNAL.test(segment) && CONVERSION_SIGNAL.test(segment);
    });
}

export function isPureInternshipPosition(title: string, jdText: string): boolean {
  if (hasInternAssessmentRequirement(`${title}\n${jdText}`)) return false;
  const headline = [title, ...jdText.split("\n").slice(0, 3)].join("\n");
  return INTERN_POSITION_SIGNAL.test(headline);
}
