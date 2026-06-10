---
mindmap-plugin: basic
mindmap-zoom: 80
---

# Edge Case Stress Test

## Bare text variations
- normal bullet
- bare text after bullet
	- bare text indented 4 spaces
		- bare text indented 8 spaces
- bullet after bare text

## Tags and special chars
- #tag-at-start
- #another-tag with text
- normal bullet
	- #indented-tag

## Orphaned indentation
- tab indented orphan
	- double tab orphan
	- four space orphan
		- eight space orphan

## Mixed indent styles
- parent with tab child
	- tab child
- parent with space child
	- four space child
		- eight space child

## Horizontal rules
- Sub title
	- before rule
- Sub title
	- Sub title
		- djfkdjdfSub title
			- dfdffdSub title
			- dfdf
	- Sub title
		- jhj
		- jkjk
	- after rules

## Deep nesting roundtrip
- level 0
	- level 1
		- level 2
			- level 3
				- level 4
					- level 5
						- level 6
							- level 7

## Back and forth depth
- top A
	- child A1
		- grandchild A1a
	- child A2
- top B
	- child B1
		- grandchild B1a
			- great B1a1
	- child B2
- top C