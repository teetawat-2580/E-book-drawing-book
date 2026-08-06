import openpyxl

def test_data_value_parser():
    wb = openpyxl.load_workbook("Batch_SQL_Manager.xlsx", data_only=False)
    ws_par = wb["SQL_To_Table_Parser"]
    
    print("Testing SQL_To_Table_Parser Data Value Formulas:")
    
    # Formula in Column B (Parsed ID):
    f_id = ws_par["B5"].value
    print("Col B (Parsed ID) Formula:", f_id)
    assert "_xlfn.TEXTAFTER(A5, \"VALUES\")" in f_id
    
    # Formula in Column C (Parsed Title):
    f_title = ws_par["C5"].value
    print("Col C (Parsed Title) Formula:", f_title)
    assert "_xlfn.TEXTAFTER(A5, \"VALUES\")" in f_title
    
    # Formula in Column D (Parsed Author):
    f_author = ws_par["D5"].value
    print("Col D (Parsed Author) Formula:", f_author)
    assert "_xlfn.TEXTAFTER(A5, \"VALUES\")" in f_author

    # Formula in Column O (Parsed Description):
    f_desc = ws_par["O5"].value
    print("Col O (Parsed Description) Formula:", f_desc)
    assert "_xlfn.TEXTAFTER(A5, \"VALUES\")" in f_desc

    print("VERIFICATION SUCCESSFUL: Formulas now target VALUES (...) clause specifically!")

if __name__ == "__main__":
    test_data_value_parser()
