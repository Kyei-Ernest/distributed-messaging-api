
file_path = '/home/ernest-kyei/Documents/distro-messaging/distributed-messaging/frontend/styles.css'

def check_mq():
    with open(file_path, 'r') as f:
        text = f.read()

    lines = text.split('\n')
    depth = 0
    in_comment = False
    
    mq_scopes = [] # (start_line, end_line, descriptor)
    
    current_mq_start = None
    current_mq_desc = None
    
    # We process char by char but track line numbers
    i = 0
    line_num = 1
    
    while i < len(text):
        char = text[i]
        
        if char == '\n':
            line_num += 1
            i += 1
            continue
            
        if in_comment:
            if text[i:i+2] == '*/':
                in_comment = False
                i += 2
                continue
            i += 1
            continue
        else:
            if text[i:i+2] == '/*':
                in_comment = True
                i += 2
                continue
            
            if char == '{':
                depth += 1
                if depth == 1: # Toplevel block opening
                    # Check if previous text on this line (or previous lines) was @media
                    # Rough backward search in text
                    lookback = text[max(0, i-200):i]
                    # Find last occurence of @media
                    m_idx = lookback.rfind('@media')
                    if m_idx != -1:
                        # Extract the condition
                        desc = lookback[m_idx:].strip()
                        current_mq_start = line_num
                        current_mq_desc = desc
            
            elif char == '}':
                depth -= 1
                if depth == 0 and current_mq_start is not None:
                    # Closed the MQ
                    mq_scopes.append((current_mq_start, line_num, current_mq_desc))
                    current_mq_start = None
                    current_mq_desc = None
        
        i += 1
        
    for start, end, desc in mq_scopes:
        print(f"MQ: {desc[:40]}... Start: {start}, End: {end}")

check_mq()
