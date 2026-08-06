import openpyxl

def test_formulas():
    # Test formula text generation for all 14 fields
    sample_sql = "INSERT INTO books (id, title, author_name, publisher, category, price, original_price, pages_count, file_type, badge, cover_image_url, file_path, sample_file_path, description) VALUES (1, 'สมุดระบายสีสัตว์น่ารัก เล่ม 1', 'คลังสมอง', 'คลังสมอง KLANGSAMONG', 'สมุดระบายสีเด็ก', 49, 99, '30 หน้า', 'PDF', 'ขายดี', 'https://cover.jpg', 'https://book.pdf', 'https://sample.pdf', 'แบบฝึกหัดระบายสี');"
    
    r = 5
    val_expr = f'IF(ISNUMBER(SEARCH("VALUES", A{r})), _xlfn.TEXTAFTER(A{r}, "VALUES"), A{r})'
    
    f_id = f'=IF(ISBLANK(A{r}), "", TRIM(SUBSTITUTE(_xlfn.TEXTBEFORE({val_expr}, ","), "(", "")))'
    f_title = f'=IF(ISBLANK(A{r}), "", TRIM(SUBSTITUTE(_xlfn.TEXTBEFORE(_xlfn.TEXTAFTER({val_expr}, ",", 1), ","), "\'", "")))'
    f_author = f'=IF(ISBLANK(A{r}), "", TRIM(SUBSTITUTE(_xlfn.TEXTBEFORE(_xlfn.TEXTAFTER({val_expr}, ",", 2), ","), "\'", "")))'
    f_desc = f'=IF(ISBLANK(A{r}), "", TRIM(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(_xlfn.TEXTAFTER({val_expr}, ",", 13), ");", ""), ")", ""), "\'", "")))'

    print("Field 1 (ID):", f_id)
    print("Field 2 (Title):", f_title)
    print("Field 3 (Author):", f_author)
    print("Field 14 (Desc):", f_desc)

test_formulas()
