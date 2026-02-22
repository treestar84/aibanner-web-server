#!/usr/bin/env python3
"""
Validate and fix all markdown files for Astro build compatibility
Ensures proper YAML frontmatter syntax
"""

import glob
import sys
import re

def validate_and_fix_md_files():
    """Validate and fix all dailyNews markdown files"""
    # Match all dailyNews files regardless of date prefix
    files = glob.glob('src/content/blog/dailyNews_*.md')

    if not files:
        print("No markdown files found")
        # Treat as a no-op so the workflow doesn't fail on first run
        return True

    fixed_count = 0
    error_count = 0

    for filepath in sorted(files):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()

            # Check frontmatter
            if not content.startswith('---'):
                print(f"❌ {filepath}: Missing frontmatter")
                error_count += 1
                continue

            # Extract frontmatter
            parts = content.split('---', 2)
            if len(parts) < 3:
                print(f"❌ {filepath}: Invalid frontmatter structure")
                error_count += 1
                continue

            frontmatter = parts[1]
            body = parts[2]

            # Check required fields
            required_fields = ['title:', 'date:', 'description:']
            for field in required_fields:
                if field not in frontmatter:
                    print(f"❌ {filepath}: Missing {field}")
                    error_count += 1
                    continue

            # Fix tags field
            original_frontmatter = frontmatter

            # Pattern 1: "tags: \n\n" or "tags: \n---" (empty with newline)
            # Pattern 2: "tags:\n- " (has items but missing space after colon)
            # Pattern 3: "tags: []" (correct empty)
            # Pattern 4: "tags: \n- " (correct with items)

            lines = frontmatter.split('\n')
            new_lines = []
            i = 0

            while i < len(lines):
                line = lines[i]

                # Check if this is tags line
                if line.strip() == 'tags:' or line.strip() == 'tags: ':
                    # Check if next line has tag items
                    has_items = False
                    if i + 1 < len(lines):
                        next_line = lines[i + 1].strip()
                        if next_line.startswith('- "'):
                            has_items = True

                    if has_items:
                        # Has items - use "tags:" without bracket
                        new_lines.append('tags:')
                    else:
                        # No items - use empty array
                        new_lines.append('tags: []')
                else:
                    new_lines.append(line)

                i += 1

            new_frontmatter = '\n'.join(new_lines)

            if new_frontmatter != original_frontmatter:
                # Reconstruct file
                new_content = f"---{new_frontmatter}---{body}"

                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(new_content)

                print(f"✅ {filepath}: Fixed tags field")
                fixed_count += 1
            else:
                print(f"✓  {filepath}: OK")

        except Exception as e:
            print(f"❌ {filepath}: Error - {e}")
            error_count += 1

    print(f"\n{'='*60}")
    print(f"Total files: {len(files)}")
    print(f"Fixed: {fixed_count}")
    print(f"Errors: {error_count}")
    print(f"OK: {len(files) - fixed_count - error_count}")
    print(f"{'='*60}")

    return error_count == 0

if __name__ == "__main__":
    success = validate_and_fix_md_files()
    sys.exit(0 if success else 1)
