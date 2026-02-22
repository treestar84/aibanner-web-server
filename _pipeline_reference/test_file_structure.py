#!/usr/bin/env python3
"""
Story 4.2: 카테고리별 RSS 및 파일 구조 테스트
File structure and naming convention validation test
"""

import re
from pathlib import Path
from datetime import datetime
import yaml


class FileStructureValidator:
    """ 파일 구조 검증"""

    # 파일명 패턴: YYYY-MM-DD-HH-mm_<slug>.md
    FILENAME_PATTERN = r'^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}_[\w-]+\.md$'

    def __init__(self, content_dir='content'):
        self.content_dir = Path(content_dir)
        self.results = {
            'total_files': 0,
            'valid_files': 0,
            'invalid_files': [],
            'categories': {},
            'filename_errors': [],
            'structure_errors': [],
            'frontmatter_errors': []
        }

    def validate_all(self):
        """전체 검증 실행"""
        print("=" * 60)
        print("File Structure Validation Test")
        print("=" * 60)

        if not self.content_dir.exists():
            print(f"❌ Content directory not found: {self.content_dir}")
            return False

        # 1. 파일 수집
        md_files = list(self.content_dir.rglob('*.md'))
        self.results['total_files'] = len(md_files)

        print(f"\n[1] Found {len(md_files)} markdown files in content/\n")

        # 2. 각 파일 검증
        for md_file in md_files:
            self._validate_file(md_file)

        # 3. 결과 출력
        self._print_results()

        return len(self.results['invalid_files']) == 0

    def _validate_file(self, file_path: Path):
        """개별 파일 검증"""
        relative_path = file_path.relative_to(self.content_dir)
        parts = relative_path.parts

        # 파일 구조 검증: content/<category>/<YYYY>/<MM>/<filename>
        if len(parts) != 4:
            self.results['structure_errors'].append({
                'file': str(relative_path),
                'error': f'Invalid path depth: {len(parts)} (expected 4)',
                'parts': parts
            })
            self.results['invalid_files'].append(str(relative_path))
            return

        category, year, month, filename = parts

        # 연도 검증
        if not (year.isdigit() and len(year) == 4):
            self.results['structure_errors'].append({
                'file': str(relative_path),
                'error': f'Invalid year format: {year}'
            })
            self.results['invalid_files'].append(str(relative_path))
            return

        # 월 검증
        if not (month.isdigit() and len(month) == 2):
            self.results['structure_errors'].append({
                'file': str(relative_path),
                'error': f'Invalid month format: {month}'
            })
            self.results['invalid_files'].append(str(relative_path))
            return

        # 파일명 형식 검증
        if not re.match(self.FILENAME_PATTERN, filename):
            self.results['filename_errors'].append({
                'file': str(relative_path),
                'filename': filename,
                'error': 'Does not match pattern YYYY-MM-DD-HH-mm_<slug>.md'
            })
            self.results['invalid_files'].append(str(relative_path))
            return

        # Frontmatter 검증
        try:
            self._validate_frontmatter(file_path)
        except Exception as e:
            self.results['frontmatter_errors'].append({
                'file': str(relative_path),
                'error': str(e)
            })
            self.results['invalid_files'].append(str(relative_path))
            return

        # 카테고리별 집계
        if category not in self.results['categories']:
            self.results['categories'][category] = 0
        self.results['categories'][category] += 1

        self.results['valid_files'] += 1

    def _validate_frontmatter(self, file_path: Path):
        """YAML frontmatter 검증"""
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # YAML frontmatter 추출
        if not content.startswith('---'):
            raise ValueError("Missing YAML frontmatter")

        parts = content.split('---', 2)
        if len(parts) < 3:
            raise ValueError("Invalid YAML frontmatter format")

        frontmatter_str = parts[1]
        try:
            frontmatter = yaml.safe_load(frontmatter_str)
        except yaml.YAMLError as e:
            raise ValueError(f"Invalid YAML: {e}")

        # 필수 필드 확인
        required_fields = ['title', 'category', 'url', 'published_at']
        for field in required_fields:
            if field not in frontmatter or not frontmatter[field]:
                raise ValueError(f"Missing required field: {field}")

    def _print_results(self):
        """검증 결과 출력"""
        print("\n" + "=" * 60)
        print("VALIDATION RESULTS")
        print("=" * 60)

        print(f"\nTotal files scanned: {self.results['total_files']}")
        print(f"Valid files: {self.results['valid_files']}")
        print(f"Invalid files: {len(self.results['invalid_files'])}")

        # 카테고리별 집계
        print(f"\n📁 Files by category:")
        for category, count in sorted(self.results['categories'].items()):
            print(f"  - {category}: {count} files")

        # 에러 상세
        if self.results['structure_errors']:
            print(f"\n❌ Structure errors ({len(self.results['structure_errors'])}):")
            for error in self.results['structure_errors'][:5]:  # 최대 5개만
                print(f"  - {error['file']}: {error['error']}")

        if self.results['filename_errors']:
            print(f"\n❌ Filename errors ({len(self.results['filename_errors'])}):")
            for error in self.results['filename_errors'][:5]:
                print(f"  - {error['filename']}: {error['error']}")

        if self.results['frontmatter_errors']:
            print(f"\n❌ Frontmatter errors ({len(self.results['frontmatter_errors'])}):")
            for error in self.results['frontmatter_errors'][:5]:
                print(f"  - {error['file']}: {error['error']}")

        # Acceptance Criteria 체크
        print("\n" + "=" * 60)
        print("ACCEPTANCE CRITERIA CHECK")
        print("=" * 60)

        criteria = [
            ("Files organized in content/<category>/<YYYY>/<MM>/",
             len(self.results['structure_errors']) == 0),
            ("Filename format: YYYY-MM-DD-HH-mm_<slug>.md",
             len(self.results['filename_errors']) == 0),
            ("Valid YAML frontmatter with required fields",
             len(self.results['frontmatter_errors']) == 0),
            ("At least 1 file generated",
             self.results['total_files'] > 0)
        ]

        all_passed = True
        for criterion, passed in criteria:
            status = "PASS" if passed else "FAIL"
            icon = "✅" if passed else "❌"
            print(f"  [{status}] {icon} {criterion}")
            if not passed:
                all_passed = False

        print("\n" + "=" * 60)
        if all_passed:
            print("✅ ALL TESTS PASSED")
        else:
            print("❌ SOME TESTS FAILED")
        print("=" * 60)


def main():
    validator = FileStructureValidator(content_dir='content')
    success = validator.validate_all()

    exit(0 if success else 1)


if __name__ == '__main__':
    main()
